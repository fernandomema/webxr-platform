/**
 * Named sections of engine code timed for the performance log (perfLog.ts): `profiled('avatar:fingers', () => ...)` adds the ms the call took to
 * the log's costs under that name. Until a sink is set (dev builds only, by the engine) it only runs the call.
 */
let sink: Map<string, number> | null = null;

export function setProfileSink(costs: Map<string, number> | null): void {
	sink = costs;
}

export function profiled<T>(name: string, run: () => T): T {
	const costs = sink;
	if (!costs) return run();
	const started = performance.now();
	try {
		return run();
	} finally {
		costs.set(name, (costs.get(name) ?? 0) + performance.now() - started);
	}
}
