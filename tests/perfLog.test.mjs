import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPerfEntry, parsePerfEntry } from '../src/lib/server/perfLog.ts';
import { percentile, topCosts } from '../packages/engine/src/xr/perfLog.ts';
import { EXPERIMENTS, activeExperiments, isExperimentOn } from '../packages/engine/src/xr/experiments.ts';

const sample = { type: 'sample', at: '2026-10-30T10:00:00Z', session: 'abc', world: 'lobby', mode: 'desktop', experiments: ['noGlow'], agent: 'x', seconds: 10, frames: 600, fps: 60, frameMsMean: 16.6, frameMsP95: 20, frameMsMax: 40, hitches: 1, tickMsMean: 0.4, cpuFrameMs: 3, drawCalls: 120, activeMeshes: 300, kTriangles: 80, topScripts: [{ id: 'jukebox-panel', ms: 2.5 }] };

test('the server keeps well-formed samples and toggles and drops the rest', () => {
	assert.deepEqual(parsePerfEntry(sample), { ...sample, settings: {} });
	assert.deepEqual(parsePerfEntry({ type: 'toggle', at: 'now', id: 'noGlow', on: true, extra: 1 }), { type: 'toggle', at: 'now', id: 'noGlow', on: true });
	assert.equal(parsePerfEntry({ ...sample, fps: 'fast' }), null);
	assert.equal(parsePerfEntry({ type: 'other', at: 'now' }), null);
	assert.equal(parsePerfEntry(null), null);
});

test('entries are appended one per line', async () => {
	const file = join(await mkdtemp(join(tmpdir(), 'perf-')), 'logs', 'perf.log');
	await appendPerfEntry({ a: 1 }, file);
	await appendPerfEntry({ b: 2 }, file);
	assert.deepEqual((await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)), [{ a: 1 }, { b: 2 }]);
});

test('experiments have unique ids and are off outside a dev build', () => {
	assert.equal(new Set(EXPERIMENTS.map((e) => e.id)).size, EXPERIMENTS.length);
	assert.deepEqual(activeExperiments(), []);
	assert.equal(isExperimentOn(EXPERIMENTS[0].id), false);
});

test('percentile picks from a sorted list', () => {
	assert.equal(percentile([], 0.95), 0);
	assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
	assert.equal(percentile([1, 2, 3, 4], 0.5), 3);
});

test('the costliest scripts are listed as milliseconds per frame', () => {
  assert.deepEqual(topCosts(new Map([['a', 10], ['b', 50], ['c', 30]]), 10, 2), [{ id: 'b', ms: 5 }, { id: 'c', ms: 3 }]);
  assert.deepEqual(topCosts(undefined, 10), []);
});

test('a frame callback is named after the file and line that added it, past this file and the dependencies', async () => {
  const { callerLocation } = await import('../packages/engine/src/xr/perfLog.ts');
  const stack = [
    'Error',
    '    at Observable.add (http://localhost:5173/packages/engine/src/xr/perfLog.ts?t=1:90:12)',
    '    at Observable.addOnce (http://localhost:5173/node_modules/.vite/deps/@babylonjs_core.js?v=abc:100:5)',
    '    at createEngine (http://localhost:5173/packages/engine/src/xr/engine.ts?t=2:615:26)'
  ].join('\n');
  assert.equal(callerLocation(stack), 'engine.ts:615');
  assert.equal(callerLocation('Error\n    at http://x/a/grabSystem.ts:12:3'), 'grabSystem.ts:12');
  assert.equal(callerLocation(undefined), null);
});

test('the server keeps the settings and the newer measurements, and still takes samples without them', () => {
  const full = parsePerfEntry({ ...sample, settings: { scriptRate: 2, foveation: 'high', multiview: true, frameRate: null, nested: { no: 1 } }, gpuFrameMs: 9.5, heapMB: 120 });
  assert.deepEqual(full.settings, { scriptRate: 2, foveation: 'high', multiview: true, frameRate: null });
  assert.equal(full.gpuFrameMs, 9.5);
  assert.equal(full.heapMB, 120);
  const old = parsePerfEntry(sample);
  assert.deepEqual(old.settings, {});
  assert.equal('gpuFrameMs' in old, false);
});

test('fewer lights limits every material, new ones too, and gives back what each had', () => {
  const listeners = [];
  const a = { maxSimultaneousLights: 4 };
  const b = { maxSimultaneousLights: 1 };
  const scene = { materials: [a, b, {}], onNewMaterialAddedObservable: { add: (f) => (listeners.push(f), f), remove: (f) => listeners.splice(listeners.indexOf(f), 1) } };
  const fewer = EXPERIMENTS.find((e) => e.id === 'fewerLights');
  fewer.apply(true, { scene, scripts: { farScripts: null } });
  assert.deepEqual([a.maxSimultaneousLights, b.maxSimultaneousLights], [2, 1]);
  const late = { maxSimultaneousLights: 6 };
  scene.materials.push(late);
  listeners[0](late);
  assert.equal(late.maxSimultaneousLights, 2);
  fewer.apply(false, { scene, scripts: { farScripts: null } });
  assert.deepEqual([a.maxSimultaneousLights, b.maxSimultaneousLights, late.maxSimultaneousLights], [4, 1, 6]);
  assert.equal(listeners.length, 0);
});

test('slow far scripts sets and clears the scene graph limit', () => {
  const scripts = { farScripts: null };
  const far = EXPERIMENTS.find((e) => e.id === 'slowFarScripts');
  far.apply(true, { scene: {}, scripts });
  assert.deepEqual(scripts.farScripts, { distance: 12, divisor: 4 });
  far.apply(false, { scene: {}, scripts });
  assert.equal(scripts.farScripts, null);
});

test('a profiled section adds its time to the sink while there is one, and only runs otherwise', async () => {
  const { profiled, setProfileSink } = await import('../packages/engine/src/xr/profiler.ts');
  assert.equal(profiled('x', () => 5), 5);
  const costs = new Map();
  setProfileSink(costs);
  try {
    profiled('area:step', () => { for (let i = 0; i < 1e5; i++); });
    profiled('area:step', () => {});
    assert.throws(() => profiled('area:fails', () => { throw new Error('no'); }));
    assert.ok(costs.get('area:step') >= 0 && costs.has('area:fails'), 'a section that throws is still counted');
  } finally { setProfileSink(null); }
  profiled('after', () => {});
  assert.equal(costs.has('after'), false);
});
