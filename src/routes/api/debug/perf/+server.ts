import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { appendPerfEntry, parsePerfEntry } from '$lib/server/perfLog';

/**
 * Dev-only sink for the page's performance samples (packages/engine/src/xr/perfLog.ts): they are appended to logs/perf.log, so that what the experiments
 * of the Settings tab are worth can be read afterwards (`node scripts/perf-summary.mjs`). A release answers 404, and the page stops sending.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!dev) return json({ ok: false }, { status: 404 });
	if (Number(request.headers.get('content-length')) > 8_192) return json({ ok: false }, { status: 413 });
	let entry: Record<string, unknown> | null = null;
	try { entry = parsePerfEntry(await request.json()); } catch { /* not JSON */ }
	if (!entry) return json({ ok: false }, { status: 400 });
	await appendPerfEntry(entry);
	return json({ ok: true });
};
