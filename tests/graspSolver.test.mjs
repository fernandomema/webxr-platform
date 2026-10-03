import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { GraspSolver } from '../src/lib/xr/avatar/graspSolver.ts';
import { solveGraspPose } from '../src/lib/xr/avatar/graspPose.ts';
import { defaultHandModel } from '../src/lib/xr/avatar/grasp.ts';

function input(x = 0, reach = 0.1) {
	return { model: defaultHandModel('right'), obstacles: [{
		kind: 'sphere', center: [x, -0.09, 0.06], half: [0.04, 0.04, 0.04], rotation: [0, 0, 0, 1]
	}], reach };
}

function fixture() {
	const jobs = [];
	const worker = {
		onmessage: null, onerror: null, onmessageerror: null, terminated: false,
		postMessage(job) { jobs.push(structuredClone(job)); },
		terminate() { this.terminated = true; },
		finish(index = jobs.length - 1) {
			const job = jobs[index];
			this.onmessage?.({ data: { id: job.id, pose: solveGraspPose(job.input) } });
		}
	};
	const solver = new GraspSolver(() => worker);
	return { worker, jobs, solver };
}

test('render samples enqueue geometry once and keep the solved pose without recomputing', () => {
	const f = fixture();
	let reads = 0;
	const makeInput = () => { reads++; return input(); };
	try {
		for (let i = 0; i < 100; i++) assert.equal(f.solver.sample('right', 'held', 'pose', makeInput), null);
		assert.equal(reads, 1);
		assert.equal(f.jobs.length, 1);
		f.worker.finish();
		const expected = solveGraspPose(input());
		const pose = f.solver.sample('right', 'held', 'pose', makeInput);
		assert.deepEqual(pose, expected);
		for (let i = 0; i < 100; i++) assert.equal(f.solver.sample('right', 'held', 'pose', makeInput), pose);
		assert.equal(reads, 1);
		assert.equal(f.jobs.length, 1);
	} finally { f.solver.dispose(); }
});

test('continuous movement coalesces to the latest pose and gives the other hand a turn', () => {
	const f = fixture();
	try {
		f.solver.sample('right', 'held', 'initial', () => input());
		f.worker.finish();
		const initial = f.solver.sample('right', 'held', 'initial', () => input());
		f.solver.sample('left', 'other', 'equip', () => input(0.01, null));
		for (let i = 1; i <= 100; i++) {
			assert.equal(f.solver.sample('right', 'held', `move-${i}`, () => input(i * 0.0001)), initial);
		}
		assert.equal(f.jobs.length, 2, 'only one request is in flight while the other hand waits');
		f.worker.finish();
		assert.equal(f.jobs.length, 3);
		assert.equal(f.jobs[2].input.obstacles[0].center[0], 0.01, 'intermediate poses are replaced');
		assert.deepEqual(f.solver.sample('left', 'other', 'equip', () => input(0.01, null)), solveGraspPose(input(0.01, null)));
		f.worker.finish();
		assert.deepEqual(f.solver.sample('right', 'held', 'move-100', () => input(0.01)), solveGraspPose(input(0.01)));
	} finally { f.solver.dispose(); }
});

test('released, replaced and re-grabbed objects ignore an obsolete in-flight result', () => {
	const f = fixture();
	try {
		f.solver.sample('right', 'old', 'pose', () => input());
		f.solver.clear('right');
		f.solver.sample('right', 'old', 'pose', () => input(0.01));
		f.worker.finish(0);
		assert.equal(f.solver.sample('right', 'old', 'pose', () => input(0.01)), null);
		f.worker.finish(1);
		assert.deepEqual(f.solver.sample('right', 'old', 'pose', () => input(0.01)), solveGraspPose(input(0.01)));
		assert.equal(f.solver.sample('right', 'different', 'pose', () => input(-0.01)), null);
		f.solver.clear('right');
		f.worker.finish(2);
		assert.equal(f.jobs.length, 3);
	} finally { f.solver.dispose(); }
});

test('worker failure preserves the grasp calculation and cache; disposal ignores late results', () => {
	const f = fixture();
	const warn = console.warn;
	console.warn = () => {};
	try {
		f.solver.sample('right', 'held', 'pose', () => input());
		f.worker.onerror({});
		assert.equal(f.worker.terminated, true);
		assert.deepEqual(f.solver.sample('right', 'held', 'pose', () => assert.fail('reuse the cache')), solveGraspPose(input()));
		f.solver.dispose();
		f.worker.finish();
		assert.equal(f.solver.sample('right', 'held', 'pose', () => assert.fail('disposed')), null);
	} finally { console.warn = warn; f.solver.dispose(); }
});

test('the actual worker entry point produces the same palm shift and fingers on a separate thread', { timeout: 10_000 }, async () => {
	const url = new URL('../src/lib/xr/avatar/grasp.worker.ts', import.meta.url).href;
	// Adapt only the worker transport to Node; load the actual production entry point and solver unchanged.
	const worker = new Worker(`
		const { parentPort, threadId } = require('node:worker_threads');
		global.self = { postMessage(data) { parentPort.postMessage({ ...data, threadId }); } };
		import(${JSON.stringify(url)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
	`, { eval: true });
	try {
		for (const reach of [0.1, null]) {
			const result = new Promise((resolve, reject) => {
				worker.once('message', resolve);
				worker.once('error', reject);
			});
			worker.postMessage({ id: reach === null ? 2 : 1, input: input(0, reach) });
			const reply = await result;
			assert.ok(reply.threadId > 0);
			assert.equal(reply.id, reach === null ? 2 : 1);
			assert.deepEqual(reply.pose, solveGraspPose(input(0, reach)));
		}
	} finally { await worker.terminate(); }
});
