/**
 * Wraps `run` so that however often the result is called, `run` happens at most once per `minIntervalMs`: the first call goes
 * straight through, and calls that come too soon are folded into one later call. Whoever calls it is never left without a
 * final `run` after their last call.
 */
export function createThrottle(
	run: () => void,
	minIntervalMs: number,
	clock: { now(): number; setTimer(callback: () => void, ms: number): unknown; clearTimer(handle: unknown): void } = {
		now: () => Date.now(),
		setTimer: (callback, ms) => setTimeout(callback, ms),
		clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
	}
): (() => void) & { cancel(): void } {
	let last = -Infinity;
	let timer: unknown = null;
	const call = (): void => {
		if (timer !== null) return; // a later run is already waiting and will cover this call
		const wait = last + minIntervalMs - clock.now();
		if (wait <= 0) {
			last = clock.now();
			run();
			return;
		}
		timer = clock.setTimer(() => {
			timer = null;
			last = clock.now();
			run();
		}, wait);
	};
	call.cancel = (): void => {
		if (timer !== null) clock.clearTimer(timer);
		timer = null;
	};
	return call;
}
