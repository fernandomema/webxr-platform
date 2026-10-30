// The jukebox script run in the real sandbox against a small world of its own: what it does, and that a frame of it stays cheap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';
import { buildJukebox } from '../src/lib/content/templates/jukebox.ts';
import { buildDisc } from '../src/lib/content/templates/recordDisc.ts';

const P = 'lobby-jukebox::';

function jukeboxWorld(records) {
  const tree = buildJukebox().map((s) => ({ ...s, id: P + s.id, parentId: s.parentId ? P + s.parentId : null, components: s.components.map((c) => ({ ...c })) }));
  const discs = records.flatMap((place, i) => buildDisc({ id: `d${i}`, title: `Song ${i}`, author: 'Band', labelColor: '#123456', source: { kind: 'url', url: `/s${i}.mp3` } }, { parentId: `${P}jukebox-slot-${place}` }));
  const slots = new Map([...tree, ...discs].map((s) => [s.id, s]));
  records.forEach((place, i) => { slots.get(`${P}jukebox-slot-${place}`).components[0].occupantId = `d${i}`; });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const nodes = new Map();
  const node = (id) => nodes.get(id) ?? nodes.set(id, new TransformNode(id, scene)).get(id);
  const played = [];
  const tracks = [];
  const counts = { getSlot: 0 };
  const known = {
    getSlot: (id) => { counts.getSlot += 1; return slots.get(id); },
    getNode: (id) => node(id),
    getChildren: () => [],
    allSlots: () => [...slots.values()],
    getGrabbers: () => [],
    getEquipHolder: () => null,
    isHost: () => true,
    setComponentField: (id, type, field, value) => { const c = slots.get(id)?.components.find((x) => x.type === type); if (c) c[field] = value; },
    reparent: (id, parent) => { const s = slots.get(id); if (s) s.parentId = parent; return true; },
    commitTransform: () => {},
    flush: () => {},
    audio: {
      playAt: async (source) => { played.push(source.url); const track = { ended: false, stopped: false, stop() { this.stopped = true; }, setPosition() {} }; tracks.push(track); return track; },
      play: () => {}
    }
  };
  const host = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  const panelId = `${P}jukebox-panel`;
  const code = slots.get(panelId).components.find((c) => c.type === 'codeBlock').code;
  const runtime = createCodeBlockHandlers(panelId, node(panelId), code, host);
  const occupant = (place) => slots.get(`${P}jukebox-slot-${place}`).components[0].occupantId || '';
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  return { runtime, slots, played, tracks, counts, occupant, settle, dispose() { runtime.dispose?.(); scene.dispose(); engine.dispose(); } };
}

const frames = (world, n) => { for (let i = 0; i < n; i++) world.runtime.tick(1 / 72); };

test('the jukebox plays its records in turn on the turntable, and moves on when one ends', async () => {
  const world = jukeboxWorld([0, 1]);
  try {
    frames(world, 20);
    await world.settle();
    frames(world, 20);
    assert.equal(world.occupant(3), 'd0', 'the first record is on the turntable');
    assert.deepEqual(world.played, ['/s0.mp3']);
    world.tracks[0].ended = true;
    frames(world, 20);
    await world.settle();
    frames(world, 20);
    assert.equal(world.occupant(3), 'd1', 'the next one takes its place');
    assert.equal(world.occupant(0), 'd0', 'and the first goes back home');
    assert.deepEqual(world.played, ['/s0.mp3', '/s1.mp3']);
    assert.match(world.slots.get(`${P}jukebox-now`).components[0].text, /Song 1/);
  } finally { world.dispose(); }
});

test('a frame of the jukebox stays cheap', async () => {
  const world = jukeboxWorld([0, 1]);
  try {
    frames(world, 40);
    await world.settle();
    frames(world, 72);
    const started = performance.now();
    frames(world, 720);
    const ms = (performance.now() - started) / 720;
    // Reading the world through whole slots every frame cost about 2 ms a frame on a desktop (10 on a Quest); it is a tenth of that now.
    assert.ok(ms < 1, `${ms.toFixed(3)} ms per frame`);
  } finally { world.dispose(); }
});

test('the lobby seats its discs in the jukebox once it has loaded, and only in empty places', async () => {
  const { buildLobbyExtras } = await import('../src/lib/content/templates/lobbyExtras.ts');
  const seat = buildLobbyExtras().find((s) => s.id === 'lobby-jukebox-records');
  const code = seat.components.find((c) => c.type === 'codeBlock').code;
  const slots = new Map();
  const disc = (id) => ({ id, parentId: null, components: [{ type: 'recordDisc', title: id }] });
  slots.set('lobby-disc-1', disc('lobby-disc-1'));
  slots.set('lobby-disc-2', disc('lobby-disc-2'));
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const poses = [];
  const known = {
    getSlot: (id) => slots.get(id),
    getNode: (id) => new TransformNode(id, scene),
    getGrabbers: () => [],
    getEquipHolder: () => null,
    isHost: () => true,
    setComponentField: (id, type, field, value) => { const c = slots.get(id)?.components.find((x) => x.type === type); if (c) c[field] = value; },
    reparent: (id, parent) => { slots.get(id).parentId = parent; return true; },
    commitTransform: (id) => poses.push(id)
  };
  const host = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => undefined) });
  const runtime = createCodeBlockHandlers(seat.id, new TransformNode(seat.id, scene), code, host);
  try {
    runtime.tick(1 / 72);
    assert.equal(slots.get('lobby-disc-1').parentId, null, 'nothing happens before the jukebox is there');
    const socket = (i, occupantId) => ({ id: `lobby-jukebox::jukebox-slot-${i}`, parentId: 'lobby-jukebox::jukebox', components: [{ type: 'socket', accepts: ['disc'], ...(occupantId ? { occupantId } : {}) }] });
    slots.set('lobby-jukebox::jukebox-slot-0', socket(0));
    slots.set('lobby-jukebox::jukebox-slot-1', socket(1, 'someone-else'));
    runtime.tick(1 / 72);
    assert.equal(slots.get('lobby-disc-1').parentId, 'lobby-jukebox::jukebox-slot-0');
    assert.equal(slots.get('lobby-jukebox::jukebox-slot-0').components[0].occupantId, 'lobby-disc-1');
    assert.equal(slots.get('lobby-disc-2').parentId, null, 'a taken place is left alone');
    assert.equal(slots.get('lobby-jukebox::jukebox-slot-1').components[0].occupantId, 'someone-else');
  } finally { runtime.dispose?.(); scene.dispose(); engine.dispose(); }
});
