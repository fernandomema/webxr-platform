/**
 * Snapshot-based undo/redo. Callers pass the state *before* a change to
 * `record`. Consecutive records sharing a `coalesceKey` within `windowMs`
 * collapse into one undo step, so typing in a field or dragging a number
 * doesn't produce dozens of steps.
 */
export class History<T> {
	private past: T[] = [];
	private future: T[] = [];
	private lastKey: string | null = null;
	private lastTime = 0;

	constructor(
		private readonly limit = 200,
		private readonly windowMs = 800,
		private readonly now: () => number = () => Date.now()
	) {}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	record(before: T, coalesceKey?: string): void {
		const time = this.now();
		const coalesce = coalesceKey !== undefined && coalesceKey === this.lastKey && time - this.lastTime < this.windowMs;
		this.lastKey = coalesceKey ?? null;
		this.lastTime = time;
		this.future = [];
		if (coalesce) return;
		this.past.push(before);
		if (this.past.length > this.limit) this.past.shift();
	}

	undo(current: T): T | undefined {
		const previous = this.past.pop();
		if (previous === undefined) return undefined;
		this.future.push(current);
		this.lastKey = null;
		return previous;
	}

	redo(current: T): T | undefined {
		const next = this.future.pop();
		if (next === undefined) return undefined;
		this.past.push(current);
		this.lastKey = null;
		return next;
	}

	clear(): void {
		this.past = [];
		this.future = [];
		this.lastKey = null;
	}
}
