import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { createTestWorld } from '../packages/engine/src/testing.ts';
import { bundleScript } from '../packages/game/scriptBundle.mjs';

const box = (id, position, scale) => createSlot({ id, name: id, position, scale, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] });
const tree = (code) => [
  createSlot({ id: 'director', name: 'director', components: [{ type: 'container' }, { type: 'codeBlock', code }] }),
  createSlot({ id: 'label', name: 'label', components: [{ type: 'textDisplay', lines: ['-'] }] }),
  box('floor', [0, -0.5, 0], [20, 1, 20]),
  box('wall', [5, 1, 0], [0.5, 2, 6])
];

test('a script written as a TypeScript module is bundled with what it imports, and runs in the test world', async () => {
  const code = await bundleScript(new URL('./fixtures/scripts/counter.ts', import.meta.url).pathname, { inject: { SEED: { start: 10 } } });
  assert.doesNotMatch(code, /import |export /, 'one self-contained body');
  const world = createTestWorld(tree(code));
  const player = world.addPlayer({ id: 'p1' });
  const run = world.run('director');
  assert.equal(world.component('label', 'textDisplay').lines[0], 'count 10', 'the shared module and the injected value are in');
  world.tick(1.02);
  assert.equal(world.component('label', 'textDisplay').lines[0], 'count 12', 'time moves only when the test moves it: ctx.time.fixed gives a step every half second');
  assert.ok(Math.abs(run.handlers.__count() - (10 + (2 * 61) / 60)) < 1e-9);
  world.press(run, 'director');
  assert.deepEqual(world.velocities, [{ playerId: 'p1', velocity: [0, 5, 0], add: true }]);
  assert.deepEqual(player.velocity, [0, 5, 0]);
  assert.equal(world.spawned.at(-1).components[0].type, 'fragment', 'ctx.world.loadFragment spawns the slot that builds it');
  assert.ok(world.slots.has('map'));
});

test('the stand-in answers the engine’s questions: slots that exist, solids to cast against, who is where', () => {
  const world = createTestWorld(tree('return {};'));
  world.addPlayer({ id: 'a', head: [0, 1.6, 0], yaw: Math.PI / 2 });
  const run = world.run('director');
  const { ctx } = run;
  assert.throws(() => ctx.world.setComponentField('nope', 'textDisplay', 'lines', []), /does not exist/);
  assert.throws(() => ctx.world.setComponentField('label', 'collider', 'shape', 'x'), /no collider/);
  const hit = ctx.physics.raycast([0, 1, 0], [1, 0, 0], 20);
  assert.equal(hit.slotId, 'wall');
  assert.ok(Math.abs(hit.t - 4.75) < 1e-6);
  assert.equal(ctx.physics.raycast([0, 1, 0], [1, 0, 0], 20, { ignore: ['wall'] }), null);
  assert.equal(ctx.physics.sphereCast([0, 1, 0], 0.3, [0, -1, 0], 5).slotId, 'floor');
  const pose = ctx.world.getPlayerPose('a');
  assert.ok(Math.abs(pose.head.forward[0] - 1) < 1e-9, 'yaw 90° looks along +X');
  assert.ok(pose.left && pose.right, 'a VR player has hands');
  assert.equal(world.addPlayer({ id: 'b', desktop: true, role: 'guest' }) && ctx.world.getPlayerPose('b').left, undefined, 'a desktop one has none');
  assert.equal(ctx.world.teleportPlayer('a', { position: [3, 0, 3], yaw: 0 }), true);
  assert.deepEqual(world.player('a').head, [3, 1.6, 3]);
  ctx.world.setSlotEnabled('wall', false);
  assert.equal(ctx.physics.raycast([0, 1, 0], [1, 0, 0], 20), null, 'a switched-off wall is not solid');
  ctx.world.spawn({ id: 'tracer', name: 'tracer', components: [{ type: 'expires', expiresAt: 1 }] }, { ephemeral: true });
  assert.equal(world.slots.has('tracer'), false, 'ephemeral slots are recorded, not kept');
  assert.equal(world.spawned.at(-1).ephemeral, true);
  world.dispose();
});

test('a guest’s world is read-only, like in the engine', () => {
  const world = createTestWorld(tree('return {};'), { isHost: false });
  const { ctx } = world.run('director');
  ctx.world.setComponentField('label', 'textDisplay', 'lines', ['changed']);
  assert.equal(world.component('label', 'textDisplay').lines[0], '-');
  assert.equal(ctx.world.setSlotEnabled('wall', false), false);
  world.dispose();
});

test('a fragment slot that is on has its content built in the test world, and off takes it down', async () => {
  const { serializeFragment, parseFragment } = await import('../packages/engine/src/assets/fragment.ts');
  const id = `sha256:${'e'.repeat(64)}`;
  const data = parseFragment(serializeFragment([box('block', [4, 1, 0], [1, 2, 6])]));
  const owner = (disabled) => ({ ...createSlot({ id: 'map', name: 'map', position: [0, 0, 0], components: [{ type: 'fragment', source: { kind: 'asset', assetId: id } }] }), ...(disabled ? { disabled: true } : {}) });
  const world = createTestWorld([createSlot({ id: 'director', name: 'director', components: [{ type: 'container' }, { type: 'codeBlock', code: 'return {};' }] }), owner(true)], { fragments: () => data });
  const { ctx } = world.run('director');
  assert.equal(world.slots.has('map::block'), false, 'off: nothing built');
  assert.equal(ctx.physics.raycast([0, 1, 0], [1, 0, 0], 20), null);
  ctx.world.setSlotEnabled('map', true);
  assert.ok(world.slots.has('map::block'), 'on: built under the owner');
  assert.equal(ctx.physics.raycast([0, 1, 0], [1, 0, 0], 20).slotId, 'map::block', 'and solid for scripts');
  assert.equal(ctx.world.getChildren ? 1 : 1, 1);
  assert.equal(world.host.allSlots().some((s) => s.id === 'map::block'), false, 'scripts do not list a fragment’s slots, as in the engine');
  ctx.world.flush();
  assert.equal(world.flushes, 1);
  ctx.world.setSlotEnabled('map', false);
  assert.equal(world.slots.has('map::block'), false, 'off again: taken down');
  const next = ctx.world.loadFragment(id, { id: 'second', position: [0, 0, 5] });
  assert.equal(next, 'second');
  assert.ok(world.slots.has('second::block'), 'loadFragment builds one more, anywhere');
  ctx.world.unloadFragment('second');
  assert.equal(world.slots.has('second::block'), false);
  world.dispose();
});
