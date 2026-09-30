import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../src/lib/studio/tree/ops.ts';
import { reduceDocOp, coalesceKeyOf } from '../src/lib/studio/state/docOps.ts';
import { quatToEuler } from '../src/lib/math/euler.ts';

function sample() {
  let n = 0;
  const nextId = () => `id-${++n}`;
  let tree = [];
  let a, b;
  ({ tree, id: a } = ops.addSlot(tree, null, { name: 'A' }, nextId));
  ({ tree, id: b } = ops.addSlot(tree, a, { name: 'B' }, nextId));
  return { tree, a, b };
}

test('rename / setPosition / setScale / setRotationEuler edit only the target slot', () => {
  const { tree, a, b } = sample();
  assert.equal(ops.getSlot(reduceDocOp(tree, { op: 'rename', id: a, name: 'Z' }).tree, a).name, 'Z');
  assert.deepEqual(ops.getSlot(reduceDocOp(tree, { op: 'setPosition', id: b, position: [1, 2, 3] }).tree, b).position, [1, 2, 3]);
  assert.deepEqual(ops.getSlot(reduceDocOp(tree, { op: 'setScale', id: b, scale: [2, 2, 2] }).tree, b).scale, [2, 2, 2]);
  const rotated = reduceDocOp(tree, { op: 'setRotationEuler', id: b, degrees: [0, 90, 0] }).tree;
  assert.ok(Math.abs(quatToEuler(ops.getSlot(rotated, b).rotation)[1] - 90) < 0.01);
  assert.deepEqual(ops.getSlot(tree, b).position, [0, 0, 0], 'input is not mutated');
  assert.equal(reduceDocOp(tree, { op: 'rename', id: 'nope', name: 'x' }), null);
});

test('component ops add, edit and remove components', () => {
  const { tree, a } = sample();
  let next = reduceDocOp(tree, { op: 'addComponent', id: a, type: 'meshRenderer' }).tree;
  assert.equal(ops.getSlot(next, a).components[0].type, 'meshRenderer');
  next = reduceDocOp(next, { op: 'setField', id: a, index: 0, key: 'color', value: '#ff0000' }).tree;
  assert.equal(ops.getSlot(next, a).components[0].color, '#ff0000');
  next = reduceDocOp(next, { op: 'addRawComponent', id: a, component: { type: 'grabbable', scalable: true } }).tree;
  assert.equal(ops.getSlot(next, a).components.length, 2);
  next = reduceDocOp(next, { op: 'removeComponent', id: a, index: 0 }).tree;
  assert.deepEqual(ops.getSlot(next, a).components.map((c) => c.type), ['grabbable']);
});

test('a preview camera on a slot that is already something goes on a child slot', () => {
  const { tree, a } = sample();
  const result = reduceDocOp(tree, { op: 'addComponent', id: a, type: 'previewCamera', nonce: 'n' });
  assert.equal(ops.getSlot(result.tree, a).components.length, 0);
  const child = ops.getSlot(result.tree, result.selectId);
  assert.equal(child.parentId, a);
  assert.equal(child.components[0].type, 'previewCamera');
  // An empty leaf slot takes the camera itself.
  const leaf = reduceDocOp(tree, { op: 'addComponent', id: sample().b, type: 'previewCamera' });
  assert.equal(leaf.selectId, undefined);
});

test('ops that create slots derive ids from the nonce, so two applications agree', () => {
  const { tree, a } = sample();
  const one = reduceDocOp(tree, { op: 'duplicate', id: a, nonce: 'x' });
  const two = reduceDocOp(tree, { op: 'duplicate', id: a, nonce: 'x' });
  assert.deepEqual(one.tree, two.tree);
  assert.equal(one.tree.length, 4);
});

test('addSlot, removeSlot and reparent follow the tree rules', () => {
  const { tree, a, b } = sample();
  const added = reduceDocOp(tree, { op: 'addSlot', parentId: b, slot: { id: 'new', name: 'N' } });
  assert.equal(added.selectId, 'new');
  assert.equal(ops.getSlot(added.tree, 'new').parentId, b);
  assert.equal(reduceDocOp(tree, { op: 'removeSlot', id: a }), null, 'the last root cannot be deleted');
  const removed = reduceDocOp(added.tree, { op: 'removeSlot', id: 'new' });
  assert.equal(removed.selectId, b);
  assert.equal(reduceDocOp(tree, { op: 'reparent', id: a, parentId: b }), null, 'no cycles');
  assert.equal(ops.getSlot(reduceDocOp(tree, { op: 'reparent', id: b, parentId: null }).tree, b).parentId, null);
});

test('edits to the same field coalesce, structural ones do not', () => {
  assert.equal(coalesceKeyOf({ op: 'setField', id: 'a', index: 1, key: 'k', value: 1 }), 'field:a:1:k');
  assert.equal(coalesceKeyOf({ op: 'setPosition', id: 'a', position: [0, 0, 0] }), 'pos:a');
  assert.equal(coalesceKeyOf({ op: 'removeSlot', id: 'a' }), undefined);
});
