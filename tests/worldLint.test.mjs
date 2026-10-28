import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { lintWorld } from '../packages/engine/src/worlds/lint.ts';
import { serializeFragment, parseFragment } from '../packages/engine/src/assets/fragment.ts';
import { EventEmitter } from 'node:events';
import { debounced, newestFile, readGameConfig, staleEngineCache, watchGame } from '../packages/game/devTools.mjs';

const plane = (id, position, extra = {}, rotation = [0, 0, 0, 1]) => createSlot({ id, name: id, position, rotation, scale: [3, 1.5, 1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } }, { type: 'textDisplay', lines: ['x'], ...extra }] });
const floor = createSlot({ id: 'floor', name: 'floor', position: [0, -0.5, 0], scale: [40, 1, 40], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] });
const rules = (tree, options) => lintWorld(tree, options).map((f) => `${f.rule}:${f.slotId}`);

test('a sign in front of the player, facing them, is fine; one in the sky or showing its back is not', () => {
  assert.deepEqual(rules([floor, plane('ok', [0, 1.8, 6])]), []);
  assert.ok(rules([floor, plane('sky', [0, 14, 6])]).includes('text-too-high:sky'), 'a sign in the sky is found');
  assert.equal(lintWorld([floor, plane('sky', [0, 14, 6])]).find((f) => f.rule === 'text-too-high').severity, 'error');
  assert.deepEqual(rules([floor, plane('back', [0, 1.8, 6], {}, [0, 1, 0, 0])]), ['text-faces-away:back']);
  assert.deepEqual(rules([floor, plane('edge', [8, 1.8, 2.5])]), ['text-grazing:edge']);
  assert.deepEqual(rules([floor, plane('turns', [0, 14, 6], { billboard: 'full' })]), ['text-too-high:turns'], 'a sign that turns to the eye is still too high to read');
  assert.deepEqual(rules([floor, plane('turns', [0, 1.8, 6], { billboard: 'y' }, [0, 1, 0, 0])]), [], 'but it does not matter which way it was put');
  assert.deepEqual(rules([floor, plane('far', [0, 40, 90])]), [], 'a sign out of reading range is not judged');
});

test('the start of the player is the world’s spawnPoint slots, or where the engine puts them', () => {
  const spawn = createSlot({ id: 'spawn', name: 'spawn', position: [0, 0, 30], components: [{ type: 'spawnPoint' }] });
  const sign = plane('sign', [0, 1.8, 6]);
  assert.deepEqual(rules([floor, sign]), []);
  assert.deepEqual(rules([floor, sign, spawn]), [], 'from z=30 it is too far to be judged');
  assert.deepEqual(rules([floor, sign, createSlot({ ...spawn, id: 's2', name: 's2', position: [0, 0, 9] }), spawn]), ['text-faces-away:sign'], 'standing beyond it, its back is what they see');
  assert.deepEqual(rules([floor, sign], { viewpoints: [[0, 1.6, 12]] }), ['text-faces-away:sign']);
});

test('a panel with buttons must have a floor under it and be within a raised arm of it', () => {
  const panel = (id, y, x = 0) => [createSlot({ id, name: id, position: [x, y, 3], scale: [1.2, 0.8, 1], components: [{ type: 'uiPanel', width: 600, height: 400, worldWidth: 1.2 }] }), createSlot({ id: `${id}-b`, parentId: id, name: 'b', components: [{ type: 'uiElement', kind: 'button', text: 'Go', width: 200, height: 40 }] })];
  assert.deepEqual(rules([floor, ...panel('low', 1.4)]), []);
  assert.deepEqual(rules([floor, ...panel('high', 9)]).filter((r) => r.startsWith('panel-')), ['panel-out-of-reach:high']);
  assert.deepEqual(rules([...panel('hover', 1.4, 100)]).filter((r) => r.startsWith('panel-')), ['panel-out-of-reach:hover'], 'with nothing under it');
});

test('what lintUiPanels finds is reported as an error of the layout rule', () => {
  const panel = createSlot({ id: 'p', name: 'p', position: [0, 1.4, 3], components: [{ type: 'uiPanel', width: 600, height: 400, worldWidth: 1.2 }] });
  const wide = createSlot({ id: 'w', parentId: 'p', name: 'w', components: [{ type: 'uiElement', kind: 'text', text: 'x', width: 900, height: 40 }] });
  const found = lintWorld([floor, panel, wide]);
  assert.deepEqual(found.map((f) => [f.rule, f.severity, f.slotId]), [['ui-layout', 'error', 'w']]);
});

test('signs inside a fragment are judged where the fragment puts them', () => {
  const id = `sha256:${'d'.repeat(64)}`;
  const data = parseFragment(serializeFragment([plane('sky', [0, 4, 0])]));
  const owner = createSlot({ id: 'map', name: 'map', position: [0, 10, 6], components: [{ type: 'fragment', source: { kind: 'asset', assetId: id } }] });
  assert.deepEqual(rules([floor, owner]), [], 'without the fragment there is nothing to judge');
  assert.ok(rules([floor, owner], { fragments: () => data }).includes('text-too-high:map::sky'));
});

test('the game’s tools: the world config, a stale engine cache, and a watcher that waits for quiet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'game-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { world: 'x' }, kithin: { world: { watch: ['src/world', 'src/script'] } } }));
  assert.deepEqual(readGameConfig(dir).world, { script: 'world', watch: ['src/world', 'src/script'] });
  assert.equal(readGameConfig(mkdtempSync(join(tmpdir(), 'none-'))).world, null);

  const engine = join(dir, 'engine'), cache = join(dir, 'node_modules/.vite/deps');
  mkdirSync(join(engine, 'src/xr'), { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(engine, 'src/xr/a.ts'), '');
  writeFileSync(join(cache, '_metadata.json'), '{}');
  const at = (file, seconds) => utimesSync(file, seconds, seconds);
  at(join(engine, 'src/xr/a.ts'), 1000); at(join(cache, '_metadata.json'), 2000);
  assert.equal(staleEngineCache({ root: dir, engineRoot: engine }), null, 'a cache newer than the engine is fine');
  at(join(engine, 'src/xr/a.ts'), 5000);
  assert.match(staleEngineCache({ root: dir, engineRoot: engine }), /xr\/a\.ts\) 50 min after .*--force/);
  assert.equal(newestFile(join(engine, 'src')).file, join(engine, 'src/xr/a.ts'));
  assert.equal(staleEngineCache({ root: mkdtempSync(join(tmpdir(), 'fresh-')), engineRoot: engine }), null, 'no cache, nothing stale');

  let runs = 0;
  const schedule = debounced(async () => { runs++; await new Promise((r) => setTimeout(r, 30)); }, 20);
  schedule(); schedule(); schedule();
  await new Promise((r) => setTimeout(r, 15)); schedule(); // inside the quiet period: the timer starts again
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(runs, 1, 'a burst of changes is one run');
  schedule();
  await new Promise((r) => setTimeout(r, 25)); schedule(); // during the run: it runs once more after
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(runs, 3);
});

test('dev reacts to the files of the game: world code builds the world, content lists the folder, and what it wrote itself is ignored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'watch-'));
  const watcher = Object.assign(new EventEmitter(), { added: [], add(folder) { this.added.push(folder); } });
  const sent = [], log = [];
  let builds = 0, lists = 0, buildOk = true;
  const changed = watchGame({
    server: { watcher, ws: { send: (m) => sent.push(m.type) } },
    root, content: join(root, 'static/content'), watch: ['src/world', 'src/script'],
    buildWorld: () => { builds++; return buildOk; }, bundleContent: () => { lists++; }, log: (l) => log.push(l), delay: 10
  });
  assert.deepEqual(watcher.added, [join(root, 'src/world'), join(root, 'src/script'), join(root, 'static/content')], 'it watches what the game declared and the content');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  watcher.emit('change', join(root, 'src/script/director.ts'));
  watcher.emit('change', join(root, 'src/world/arena.ts'));
  await settle();
  assert.deepEqual([builds, lists, sent], [1, 1, ['full-reload']], 'two edits are one build, then the content is listed again and the page reloads');
  watcher.emit('add', join(root, 'static/content/models/rock.glb'));
  await settle();
  assert.deepEqual([builds, lists, sent.length], [1, 2, 2], 'a new file lists the folder without building the world');
  watcher.emit('change', join(root, 'static/content/bundle.json'));
  watcher.emit('change', join(root, 'static/content/.gitignore'));
  watcher.emit('change', join(root, 'src/elsewhere/other.ts'));
  await settle();
  assert.deepEqual([builds, lists, sent.length], [1, 2, 2], 'what it wrote itself, and what is not the game\'s, does nothing');
  buildOk = false;
  changed(join(root, 'src/world/arena.ts'));
  await settle();
  assert.equal(sent.length, 2, 'a world that does not build does not reload the page');
  assert.match(log.at(-1), /did not build/);
});
