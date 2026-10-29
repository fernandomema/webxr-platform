import assert from 'node:assert/strict';
import test from 'node:test';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { hashSlot } from '../packages/engine/src/ecs/slotHash.ts';
import { createTestWorld } from '../packages/engine/src/testing.ts';

const fixture = () => [
  createSlot({ id: 'gift', parentId: 'somewhere', name: 'Lantern', position: [2, 1, 3], rotation: [0, 0.7, 0, 0.7], scale: [2, 2, 2], components: [
    { type: 'grabbable', scalable: false },
    { type: 'scriptState', data: { holder: 'player-1' } },
    { type: 'socket', accepts: ['gift'], radius: 0.5, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, occupantId: 'other' },
    { type: 'audioPlayer', source: { kind: 'url', url: 'https://example.com/chime.ogg' }, playing: true, currentTime: 12 }
  ] }),
  createSlot({ id: 'glass', parentId: 'gift', name: 'Glass', position: [0, 0.2, 0], scale: [0.2, 0.3, 0.2], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#8ff0cf' }] }),
  createSlot({ id: 'cap', parentId: 'gift', name: 'Cap', position: [0, 0.4, 0], scale: [0.25, 0.08, 0.25], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#111827' }] })
];

const copied = (tree, { ids = false, pose = false, order = false } = {}) => {
  const result = structuredClone(tree);
  if (ids) for (const slot of result) {
    const old = slot.id;
    slot.id = `copy-${old}`;
    for (const child of result) if (child.parentId === old) child.parentId = slot.id;
    if (slot.parentId === 'somewhere') slot.parentId = 'another-parent';
  }
  if (pose) Object.assign(result[0], { position: [-8, 0.1, 4], rotation: [0.2, 0.1, 0.3, 0.9], scale: [0.5, 0.5, 0.5] });
  if (order) {
    result.reverse();
    result.find((slot) => slot.name === 'Lantern').components.reverse();
  }
  return result;
};

const digest = (tree) => {
  const byParent = new Map();
  for (const slot of tree) {
    const siblings = byParent.get(slot.parentId) ?? [];
    siblings.push(slot);
    byParent.set(slot.parentId, siblings);
  }
  const root = tree.find((slot) => slot.name === 'Lantern');
  return hashSlot(root, (id) => byParent.get(id) ?? []);
};

test('slot fingerprints match inventory copies with fresh ids, root poses and different serialization order', async () => {
  const original = fixture();
  const baseline = await digest(original);
  assert.match(baseline, /^[a-f0-9]{64}$/);
  assert.equal(await digest(copied(original, { ids: true, pose: true, order: true })), baseline);
  original[0].components.find((c) => c.type === 'scriptState').data.holder = 'another-player';
  original[0].components.find((c) => c.type === 'socket').occupantId = undefined;
  original[0].components.find((c) => c.type === 'audioPlayer').currentTime = 99;
  assert.equal(await digest(original), baseline);
});

test('slot fingerprints change with geometry, components and descendants', async () => {
  const original = fixture();
  const baseline = await digest(original);
  const color = copied(original);
  color.find((slot) => slot.name === 'Glass').components[0].color = '#fb923c';
  assert.notEqual(await digest(color), baseline);
  const component = copied(original);
  component[0].components.push({ type: 'equippable', left: { position: [0, 0, 0], rotation: [0, 0, 0] }, right: { position: [0, 0, 0], rotation: [0, 0, 0] } });
  assert.notEqual(await digest(component), baseline);
  const child = copied(original);
  child.find((slot) => slot.name === 'Cap').position[1] += 0.1;
  assert.notEqual(await digest(child), baseline);
  assert.notEqual(await digest(copied(original).filter((slot) => slot.name !== 'Cap')), baseline);
});

test('ctx.hierarchy.getSlotHash exposes the same hash and returns null for a missing slot', async (t) => {
  const tree = fixture();
  const world = createTestWorld(tree);
  t.after(() => world.dispose());
  const run = world.run('gift', { code: 'return {};' });
  const root = world.slot('gift');
  const expected = await hashSlot(root, (id) => tree.filter((slot) => slot.parentId === id));
  assert.equal(await run.ctx.hierarchy.getSlotHash('gift'), expected);
  assert.equal(await run.ctx.hierarchy.getSlotHash('missing'), null);
});
