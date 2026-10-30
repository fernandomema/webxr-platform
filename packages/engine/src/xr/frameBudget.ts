/**
 * Work that has to happen on the main thread (making a model's meshes, uploading a texture to the GPU) but does not have to happen
 * all at once. Tasks wait in a queue and a few run each frame, so a world that brings in dozens of things shows them one after
 * another instead of freezing for the sum of their costs. The most urgent task goes first.
 */
export class FrameBudget {
	private tasks: { run: () => void; priority: number; key?: unknown }[] = [];

	/** `budgetMs` is how long one frame may spend on queued work; at least one task always runs, so the queue cannot starve. */
	constructor(private budgetMs: number, private now: () => number = () => performance.now()) {}

	get pending(): number {
		return this.tasks.length;
	}

	/** Queues `run`. A task queued again under the same `key` replaces the earlier one. */
	enqueue(run: () => void, priority = 0, key?: unknown): void {
		if (key !== undefined) this.cancel(key);
		this.tasks.push({ run, priority, key });
	}

	has(key: unknown): boolean {
		return this.tasks.some((task) => task.key === key);
	}

	cancel(key: unknown): void {
		this.tasks = this.tasks.filter((task) => task.key !== key);
	}

	/** Runs queued tasks until the frame's budget is spent. Call once per frame. */
	run(): void {
		if (this.tasks.length === 0) return;
		const start = this.now();
		do {
			let best = 0;
			for (let i = 1; i < this.tasks.length; i++) if (this.tasks[i].priority > this.tasks[best].priority) best = i;
			const [task] = this.tasks.splice(best, 1);
			try {
				task.run();
			} catch (error) {
				console.warn('[frameBudget] a deferred task failed', error);
			}
		} while (this.tasks.length > 0 && this.now() - start < this.budgetMs);
	}

	clear(): void {
		this.tasks = [];
	}
}
