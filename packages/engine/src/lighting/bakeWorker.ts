import { parentPort, workerData } from 'node:worker_threads';
import { bakeRows, planBake, type BakeOptions } from './bake.ts';
import type { BakeScene, VolumeSpec } from './types.ts';

// One thread of a parallel bake (see `parallel.ts`): builds the plan once, then computes the rows it is given.
interface Init { scene: BakeScene; spec: VolumeSpec; options: BakeOptions; buffers: [SharedArrayBuffer, SharedArrayBuffer] }
const init = workerData as Init;
const plan = planBake(init.scene, init.spec, init.options);
const views = [new Float32Array(init.buffers[0]), new Float32Array(init.buffers[1])];

parentPort!.on('message', (job: { pass: number; from: number; to: number }) => {
	bakeRows(plan, job.pass === 0 ? null : views[(job.pass - 1) % 2], views[job.pass % 2], job.from, job.to);
	parentPort!.postMessage({ done: true });
});
parentPort!.postMessage({ ready: true });
