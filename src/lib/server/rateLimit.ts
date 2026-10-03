/** Fixed-window limiter kept in this process's memory: enough to stop a runaway script, not a distributed quota. */
const windows = new Map<string, { start: number; count: number }>();

export function takeRateToken(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
	const current = windows.get(key);
	if (!current || now - current.start >= windowMs) {
		windows.set(key, { start: now, count: 1 });
		if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
		return true;
	}
	current.count++;
	return current.count <= limit;
}
