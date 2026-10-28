import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { bakeRows, finishBake, planBake, type BakeOptions, type BakePlan } from './bake.ts';
import type { BakeScene, BakedVolume, VolumeSpec } from './types.ts';

export interface ParallelBakeOptions extends BakeOptions {
	/** Threads to use (the machine's cores, up to 8, by default). 1 bakes on this thread. */
	threads?: number;
	/** Rows of the volume handed to a thread at a time (4): small enough to balance the load, large enough not to talk too much. */
	chunk?: number;
}

/**
 * `bake` over several threads of Node. The rows of a pass do not depend on each other, so threads take them from a queue and write
 * into one shared buffer; a pass ends when every row is in, and the next one reads it. The volume is the same as `bake`'s to the
 * last bit, whatever the number of threads. For scripts (it needs `worker_threads`), not for the browser.
 */
export async function bakeParallel(scene: BakeScene, spec: VolumeSpec, options: ParallelBakeOptions = {}): Promise<{ volume: BakedVolume; plan: BakePlan }> {
	const plan = planBake(scene, spec, options);
	const rows = spec.dims[2];
	const chunk = Math.max(1, options.chunk ?? 4);
	const threads = Math.max(1, Math.min(options.threads ?? Math.min(8, availableParallelism()), Math.ceil(rows / chunk)));
	const bytes = plan.floats * Float32Array.BYTES_PER_ELEMENT;
	const buffers: [SharedArrayBuffer, SharedArrayBuffer] = [new SharedArrayBuffer(bytes), new SharedArrayBuffer(bytes)];
	const views = [new Float32Array(buffers[0]), new Float32Array(buffers[1])];

	if (threads === 1) {
		for (let pass = 0; pass < plan.passes; pass++) {
			bakeRows(plan, pass === 0 ? null : views[(pass - 1) % 2], views[pass % 2], 0, rows, (z) => options.progress?.((pass + (z + 1) / rows) / plan.passes));
		}
		return { volume: finishBake(plan, Float32Array.from(views[(plan.passes - 1) % 2])), plan };
	}

	const { passes, samples, maxDistance, blur } = plan;
	const workers = Array.from({ length: threads }, () => new Worker(new URL('./bakeWorker.ts', import.meta.url), { workerData: { scene, spec, options: { samples, passes, maxDistance, blur }, buffers } }));
	try {
		await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
			worker.once('message', () => resolve());
			worker.once('error', reject);
		})));
		let done = 0;
		const total = passes * rows;
		for (let pass = 0; pass < passes; pass++) {
			let next = 0;
			await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
				const give = () => {
					if (next >= rows) { worker.off('message', onMessage); worker.off('error', onError); resolve(); return; }
					const from = next, to = Math.min(rows, next + chunk);
					next = to;
					worker.postMessage({ pass, from, to });
					done += to - from;
				};
				const onMessage = () => { options.progress?.(Math.min(1, done / total)); give(); };
				const onError = (error: Error) => { worker.off('message', onMessage); reject(error); };
				worker.on('message', onMessage);
				worker.once('error', onError);
				give();
			})));
		}
	} finally {
		await Promise.all(workers.map((worker) => worker.terminate()));
	}
	return { volume: finishBake(plan, Float32Array.from(views[(passes - 1) % 2])), plan };
}
