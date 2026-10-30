import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Where the dev performance log goes (see packages/engine/src/xr/perfLog.ts): one JSON object per line. */
export const PERF_LOG_FILE = 'logs/perf.log';
const MAX_BYTES = 5 * 1024 * 1024;

const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? value.slice(0, max) : null);
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A sample or a toggle from the page, cut down to the fields the log keeps. Null for anything else. */
export function parsePerfEntry(body: unknown): Record<string, unknown> | null {
	if (!body || typeof body !== 'object') return null;
	const entry = body as Record<string, unknown>;
	const at = text(entry.at, 40);
	if (!at) return null;
	if (entry.type === 'toggle') {
		const id = text(entry.id, 60);
		return id && typeof entry.on === 'boolean' ? { type: 'toggle', at, id, on: entry.on } : null;
	}
	if (entry.type !== 'sample') return null;
	const experiments = Array.isArray(entry.experiments) ? entry.experiments.filter((id): id is string => typeof id === 'string').slice(0, 20).map((id) => id.slice(0, 60)) : [];
	const parsed: Record<string, unknown> = { type: 'sample', at, session: text(entry.session, 20), world: text(entry.world, 100), mode: entry.mode === 'xr' ? 'xr' : 'desktop', experiments, agent: text(entry.agent, 140) };
	const top = Array.isArray(entry.topScripts) ? entry.topScripts.flatMap((item) => {
		const row = item as { id?: unknown; ms?: unknown };
		const id = text(row?.id, 120);
		const ms = number(row?.ms);
		return id && ms !== null ? [{ id, ms }] : [];
	}).slice(0, 20) : [];
	parsed.topScripts = top;
	const settings: Record<string, string | number | boolean | null> = {};
	if (entry.settings && typeof entry.settings === 'object') {
		for (const [key, value] of Object.entries(entry.settings as Record<string, unknown>).slice(0, 12)) {
			if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') settings[key.slice(0, 40)] = typeof value === 'string' ? value.slice(0, 40) : value;
		}
	}
	parsed.settings = settings;
	for (const key of ['activeMeshesMs', 'renderTargetsMs', 'renderMs', 'interFrameMs', 'gpuFrameMs', 'longTasks', 'longTaskMs', 'meshes', 'materials', 'textures', 'lights', 'heapMB']) {
		const value = number(entry[key]);
		if (value !== null) parsed[key] = value;
	}
	for (const key of ['seconds', 'frames', 'fps', 'frameMsMean', 'frameMsP95', 'frameMsMax', 'hitches', 'tickMsMean', 'cpuFrameMs', 'drawCalls', 'activeMeshes', 'kTriangles']) {
		const value = number(entry[key]);
		if (value === null) return null;
		parsed[key] = value;
	}
	return parsed;
}

/** Adds a line to the log, moving the log aside (to `.1`, replacing the one before) once it is big. */
export async function appendPerfEntry(entry: Record<string, unknown>, file = PERF_LOG_FILE): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const size = await stat(file).then((info) => info.size, () => 0);
	if (size > MAX_BYTES) await rename(file, `${file}.1`);
	await appendFile(file, `${JSON.stringify(entry)}\n`);
}
