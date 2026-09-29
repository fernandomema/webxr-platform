import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EquipmentRegistry, isEquipHand } from '../src/lib/xr/interaction/equipmentRegistry.ts';

test('a hand holds one object and an object sits in one hand', () => {
  const registry = new EquipmentRegistry();
  assert.deepEqual(registry.equip('p1', 'right', 'gun'), { ok: true, replaced: null });
  assert.deepEqual(registry.equip('p1', 'left', 'gun'), { ok: false, reason: 'slot-equipped' });
  assert.deepEqual(registry.equip('p2', 'right', 'gun'), { ok: false, reason: 'slot-equipped' });
  assert.deepEqual(registry.equip('p1', 'right', 'knife'), { ok: false, reason: 'hand-occupied' });
  assert.equal(registry.getSlot('p1', 'right'), 'gun');
  assert.deepEqual(registry.getHolder('gun'), { playerId: 'p1', hand: 'right', slotId: 'gun' });
});

test('replacing is explicit and frees the previous object', () => {
  const registry = new EquipmentRegistry();
  registry.equip('p1', 'right', 'gun');
  assert.deepEqual(registry.equip('p1', 'right', 'knife', { replace: true }), { ok: true, replaced: 'gun' });
  assert.equal(registry.getHolder('gun'), null);
  assert.equal(registry.getSlot('p1', 'right'), 'knife');
  // Re-equipping the same object in the same hand is a no-op success.
  assert.deepEqual(registry.equip('p1', 'right', 'knife'), { ok: true, replaced: null });
});

test('unequip, disconnect and deletion release the association', () => {
  const registry = new EquipmentRegistry();
  registry.equip('p1', 'left', 'a');
  registry.equip('p1', 'right', 'b');
  registry.equip('p2', 'left', 'c');
  assert.equal(registry.unequip('p1', 'left'), 'a');
  assert.equal(registry.unequip('p1', 'left'), null);
  assert.deepEqual(registry.releasePlayer('p1').map((e) => e.slotId), ['b']);
  assert.equal(registry.releaseSlot('c')?.playerId, 'p2');
  assert.deepEqual(registry.list(), []);
  registry.equip('p3', 'left', 'x');
  assert.equal(registry.clear().length, 1);
  assert.equal(registry.getSlot('p3', 'left'), null);
});

test('isEquipHand only accepts left and right', () => {
  assert.ok(isEquipHand('left') && isEquipHand('right'));
  assert.ok(!isEquipHand('none') && !isEquipHand(undefined));
});
