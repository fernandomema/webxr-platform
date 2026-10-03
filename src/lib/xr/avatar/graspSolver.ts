import { solveGraspPose, type GraspInput, type GraspJob, type GraspPose, type GraspReply } from './graspPose.ts';

export interface GraspWorker {
	postMessage(job: GraspJob): void;
	terminate(): void;
	onmessage: ((event: MessageEvent<GraspReply>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
}

interface HandState {
	context: string;
	solvedKey: string | null;
	pose: GraspPose | null;
}

interface PendingGrasp {
	handId: string;
	state: HandState;
	key: string;
	job: GraspJob;
}

/**
 * Keeps the last finger pose while geometry is solved off the render thread. There is only one in-flight job and one
 * latest pending pose per hand, so moving an object faster than the worker cannot build an ever-growing message queue.
 */
export class GraspSolver {
	private worker: GraspWorker | null = null;
	private synchronous = false;
	private disposed = false;
	private sequence = 0;
	private hands = new Map<string, HandState>();
	private pending = new Map<string, PendingGrasp>();
	private active: PendingGrasp | null = null;

	constructor(private createWorker: () => GraspWorker = () => new Worker(new URL('./grasp.worker.ts', import.meta.url), { type: 'module' })) {}

	/** `context` identifies the held object and rig; `key` describes its geometry relative to the hand. */
	sample(handId: string, context: string, key: string, input: () => GraspInput): GraspPose | null {
		if (this.disposed) return null;
		let state = this.hands.get(handId);
		if (!state || state.context !== context) {
			state = { context, solvedKey: null, pose: null };
			this.hands.set(handId, state);
		}
		if (state.solvedKey === key) {
			this.pending.delete(handId);
		} else if (this.active?.state === state && this.active.key === key) {
			this.pending.delete(handId);
		} else if (this.pending.get(handId)?.state !== state || this.pending.get(handId)?.key !== key) {
			this.pending.set(handId, { handId, state, key, job: { id: ++this.sequence, input: input() } });
		}
		this.pump();
		return state.pose;
	}

	clear(handId: string): void {
		this.hands.delete(handId);
		this.pending.delete(handId);
	}

	dispose(): void {
		this.disposed = true;
		this.worker?.terminate();
		this.worker = null;
		this.active = null;
		this.hands.clear();
		this.pending.clear();
	}

	private pump(): void {
		if (this.active || this.disposed) return;
		const next = this.pending.values().next().value as PendingGrasp | undefined;
		if (!next) return;
		this.pending.delete(next.handId);
		this.active = next;
		if (!this.synchronous) {
			try {
				if (!this.worker) {
					this.worker = this.createWorker();
					this.worker.onmessage = ({ data }) => {
						if (data.id !== this.active?.job.id) return;
						this.complete(data.pose);
					};
					this.worker.onerror = () => this.fallback();
					this.worker.onmessageerror = () => this.fallback();
				}
				this.worker.postMessage(next.job);
				return;
			} catch {
				this.fallback();
				return;
			}
		}
		this.complete(solveGraspPose(next.job.input));
	}

	private complete(pose: GraspPose): void {
		const active = this.active;
		if (!active || this.disposed) return;
		// A released object, a replaced rig or a different object in this hand must not receive the old result.
		if (this.hands.get(active.handId) === active.state) {
			active.state.solvedKey = active.key;
			active.state.pose = pose;
		}
		this.active = null;
		this.pump();
	}

	private fallback(): void {
		if (this.disposed || this.synchronous) return;
		this.synchronous = true;
		this.worker?.terminate();
		this.worker = null;
		console.warn('[avatar] grasp worker unavailable; using the cached synchronous solver');
		if (this.active) this.complete(solveGraspPose(this.active.job.input));
	}
}
