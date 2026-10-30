// Summarises logs/perf.log: for each world, mode and device, the samples grouped by configuration (the experiments on and the performance
// settings), weighted by their length, each one compared with the default configuration; then where the time goes in each configuration:
// scripts (by slot id), steps of the scene graph's tick (#name), per-frame callbacks (@before|@after file:line) and sections of engine code
// (area:name, e.g. avatar:fingers or gui:<texture>).
// Usage: node scripts/perf-summary.mjs [file] [--since=HH:MM]
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--')) ?? 'logs/perf.log';
const since = args.find((arg) => arg.startsWith('--since='))?.slice(8);
if (!existsSync(file)) {
	console.error(`No ${file} yet: play in a dev build with the Settings tab's experiments.`);
	process.exit(1);
}
const samples = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
	try {
		const entry = JSON.parse(line);
		return entry.type === 'sample' && (!since || entry.at.slice(11, 16) >= since) ? [entry] : [];
	} catch {
		return [];
	}
});

/** Settings at their defaults are left out of a configuration's name, so that it reads as what was changed. */
const DEFAULTS = { scriptRate: 1, foveation: 'high', multiview: true, frameRate: null };
const configOf = (sample) => {
	const changed = Object.entries(sample.settings ?? {}).filter(([key, value]) => key in DEFAULTS && DEFAULTS[key] !== value).map(([key, value]) => `${key}=${value}`);
	return [...sample.experiments, ...changed].join(' + ') || '(default)';
};
const FIELDS = ['fps', 'frameMsMean', 'frameMsP95', 'hitches', 'tickMsMean', 'cpuFrameMs', 'activeMeshesMs', 'renderTargetsMs', 'renderMs', 'gpuFrameMs', 'drawCalls', 'activeMeshes', 'longTaskMs'];

const groups = new Map();
for (const sample of samples) {
	const key = `${sample.world ?? '(home)'} | ${sample.mode} | ${sample.agent?.includes('OculusBrowser') ? 'quest' : 'pc'}`;
	const config = configOf(sample);
	const world = groups.get(key) ?? new Map();
	const entry = world.get(config) ?? { seconds: 0, weights: {}, sum: {}, costs: new Map() };
	entry.seconds += sample.seconds;
	for (const field of FIELDS) {
		if (typeof sample[field] !== 'number') continue;
		entry.sum[field] = (entry.sum[field] ?? 0) + sample[field] * sample.seconds;
		entry.weights[field] = (entry.weights[field] ?? 0) + sample.seconds;
	}
	for (const { id, ms } of sample.topScripts ?? []) entry.costs.set(id, (entry.costs.get(id) ?? 0) + ms * sample.seconds);
	world.set(config, entry);
	groups.set(key, world);
}

const avg = (entry, field) => (entry.weights[field] ? entry.sum[field] / entry.weights[field] : NaN);
const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '-');
for (const [key, world] of groups) {
	console.log(`\n=== ${key}`);
	const base = world.get('(default)');
	for (const [config, entry] of [...world].sort((a, b) => a[0].localeCompare(b[0]))) {
		const delta = base && entry !== base ? `  ${fmt(((avg(entry, 'frameMsMean') - avg(base, 'frameMsMean')) / avg(base, 'frameMsMean')) * 100)}% frame vs default` : '';
		console.log(`  ${config}  [${Math.round(entry.seconds)}s]${delta}`);
		console.log(`      fps ${fmt(avg(entry, 'fps'))}  frame ${fmt(avg(entry, 'frameMsMean'), 2)}ms p95 ${fmt(avg(entry, 'frameMsP95'), 2)}  hitches/10s ${fmt(avg(entry, 'hitches'))}  long tasks ${fmt(avg(entry, 'longTaskMs'), 0)}ms`);
		console.log(`      tick ${fmt(avg(entry, 'tickMsMean'), 2)}ms  cpu ${fmt(avg(entry, 'cpuFrameMs'), 2)}ms  culling ${fmt(avg(entry, 'activeMeshesMs'), 2)}ms  targets ${fmt(avg(entry, 'renderTargetsMs'), 2)}ms  draw ${fmt(avg(entry, 'renderMs'), 2)}ms  gpu ${fmt(avg(entry, 'gpuFrameMs'), 2)}ms  draws ${fmt(avg(entry, 'drawCalls'), 0)}  meshes ${fmt(avg(entry, 'activeMeshes'), 0)}`);
		const costs = [...entry.costs].map(([id, total]) => ({ id, ms: total / entry.seconds })).sort((a, b) => b.ms - a.ms);
		const section = (id) => /^[a-z]+:[^:]/.test(id);
		for (const [title, test] of [['scripts', (id) => !id.startsWith('#') && !id.startsWith('@') && !section(id)], ['engine tick', (id) => id.startsWith('#')], ['frame callbacks', (id) => id.startsWith('@')], ['engine sections', section]]) {
			const rows = costs.filter((row) => test(row.id)).slice(0, 6);
			if (rows.length) console.log(`      ${title}: ${rows.map((row) => `${row.id} ${row.ms.toFixed(2)}`).join(', ')}`);
		}
	}
	if (!base) console.log('  (no samples with the default configuration here yet: play a while with every experiment off and the settings at their defaults)');
}
