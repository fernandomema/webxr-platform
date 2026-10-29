import type { AgentCall } from './providers';

/** A run may take this many model calls; the loop guard, not this number, is what normally stops a stuck agent. */
export const MAX_AGENT_STEPS = 500;

const CYCLE_REPEATS = 3;
const MAX_CYCLE_PERIOD = 3;
const MAX_IDENTICAL = 6;

/**
 * Spots an agent that is going round in circles. A step is the set of tool calls the model asked for plus a fingerprint of the
 * draft they ran against, so asking for the same thing again on an unchanged draft is the sign of no progress. Three identical
 * steps in a row, a 2- or 3-step cycle repeated three times, or the same step six times in a run all count as a loop.
 */
export class LoopGuard {
	private readonly history: string[] = [];
	private readonly seen = new Map<string, number>();

	/** Records one step and returns why the run should pause, or null when it looks healthy. */
	record(calls: AgentCall[], draftState: string): string | null {
		const signature = `${draftState}|${calls.map((call) => `${call.name}:${JSON.stringify(call.arguments)}`).sort().join(';')}`;
		this.history.push(signature);
		const count = (this.seen.get(signature) ?? 0) + 1;
		this.seen.set(signature, count);
		if (count >= MAX_IDENTICAL) return `The agent made the same request ${count} times without changing anything.`;
		for (let period = 1; period <= MAX_CYCLE_PERIOD; period++) {
			const length = period * CYCLE_REPEATS;
			if (this.history.length < length) continue;
			const tail = this.history.slice(-length);
			if (tail.every((entry, index) => entry === tail[index % period])) {
				return period === 1 ? `The agent repeated the same request ${CYCLE_REPEATS} times in a row.` : `The agent is cycling through the same ${period} requests.`;
			}
		}
		return null;
	}

	reset(): void {
		this.history.length = 0;
		this.seen.clear();
	}
}
