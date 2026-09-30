import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ops from '../src/lib/studio/tree/ops.ts';
import { quatToEuler, eulerToQuat } from '../src/lib/math/euler.ts';
import { History } from '../src/lib/studio/state/history.ts';
import { COMPONENT_SCHEMAS, componentSchema, addableComponents } from '../src/lib/studio/schema/components.ts';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

function sampleTree() {
  const nextId = ids();
  let tree = [];
  let a, b, c;
  ({ tree, id: a } = ops.addSlot(tree, null, { name: 'A' }, nextId));
  ({ tree, id: b } = ops.addSlot(tree, a, { name: 'B' }, nextId));
  ({ tree, id: c } = ops.addSlot(tree, b, { name: 'C' }, nextId));
  return { tree, a, b, c, nextId };
}

test('flattenTree gives real depth and honours collapsed nodes', () => {
  const { tree, a, b } = sampleTree();
  assert.deepEqual(ops.flattenTree(tree).map((r) => [r.slot.name, r.depth]), [['A', 0], ['B', 1], ['C', 2]]);
  assert.deepEqual(ops.flattenTree(tree, new Set([b])).map((r) => r.slot.name), ['A', 'B']);
  assert.deepEqual(ops.flattenTree(tree, new Set([a])).map((r) => r.slot.name), ['A']);
});

test('removeSlot removes descendants and refuses to empty the tree', () => {
  const { tree, a, b } = sampleTree();
  assert.deepEqual(ops.removeSlot(tree, b).map((s) => s.name), ['A']);
  assert.equal(ops.removeSlot(tree, a), null);
});

test('duplicateSlot clones the subtree with fresh ids and remapped parents', () => {
  const { tree, b, nextId } = sampleTree();
  const result = ops.duplicateSlot(tree, b, nextId);
  assert.equal(result.tree.length, 5);
  const copy = ops.getSlot(result.tree, result.id);
  assert.equal(copy.name, 'B copy');
  assert.equal(copy.parentId, ops.getSlot(tree, b).parentId);
  const copyChild = result.tree.find((s) => s.parentId === result.id);
  assert.equal(copyChild.name, 'C');
  assert.equal(new Set(result.tree.map((s) => s.id)).size, 5);
});

test('insertSubtree copies a fragment under the parent with fresh ids', () => {
  const { tree, b, nextId } = sampleTree();
  const fragment = [
    { id: 'r', parentId: null, name: 'R', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] },
    { id: 'k', parentId: 'r', name: 'K', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] }
  ];
  const result = ops.insertSubtree(tree, b, fragment, nextId);
  assert.equal(result.tree.length, 5);
  assert.equal(ops.getSlot(result.tree, result.id).parentId, b);
  assert.equal(result.tree.find((s) => s.name === 'K').parentId, result.id);
  assert.equal(ops.insertSubtree(tree, b, [], nextId), null);
});

test('reparent refuses cycles and unknown parents', () => {
  const { tree, a, b, c } = sampleTree();
  assert.equal(ops.reparent(tree, a, c), null);
  assert.equal(ops.reparent(tree, a, a), null);
  assert.equal(ops.reparent(tree, b, 'missing'), null);
  assert.equal(ops.getSlot(ops.reparent(tree, c, a), c).parentId, a);
  assert.equal(ops.getSlot(ops.reparent(tree, c, null), c).parentId, null);
});

test('operations never mutate their input', () => {
  const { tree, a } = sampleTree();
  const before = JSON.stringify(tree);
  ops.updateSlot(tree, a, { name: 'X' });
  ops.addComponent(tree, a, { type: 'container' });
  ops.setComponentField(ops.addComponent(tree, a, { type: 'collider', shape: 'box' }), a, 0, 'shape', 'sphere');
  assert.equal(JSON.stringify(tree), before);
});

test('setComponentField sets and clears optional keys', () => {
  const { tree, a } = sampleTree();
  let next = ops.addComponent(tree, a, { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#fff' });
  next = ops.setComponentField(next, a, 0, 'color', undefined);
  assert.equal('color' in ops.getSlot(next, a).components[0], false);
  next = ops.setComponentField(next, a, 0, 'meshRef', { kind: 'builtin', id: 'sphere' });
  assert.deepEqual(ops.getSlot(next, a).components[0].meshRef, { kind: 'builtin', id: 'sphere' });
});

test('euler <-> quaternion round trips', () => {
  for (const euler of [[0, 0, 0], [30, 45, 10], [-80, 120, -170], [10, -30, 60]]) {
    const back = quatToEuler(eulerToQuat(euler));
    const again = eulerToQuat(back);
    const q = eulerToQuat(euler);
    // q and -q are the same rotation.
    const sign = Math.sign(q.reduce((s, v, i) => s + v * again[i], 0));
    q.forEach((v, i) => assert.ok(Math.abs(v - sign * again[i]) < 1e-6, `${euler} component ${i}`));
  }
  assert.deepEqual(eulerToQuat([0, 0, 0]), [0, 0, 0, 1]);
});

test('every component type has a schema and a valid blank instance', () => {
  const types = COMPONENT_SCHEMAS.map((s) => s.type);
  assert.equal(new Set(types).size, 29);
  for (const schema of COMPONENT_SCHEMAS) {
    assert.equal(componentSchema(schema.type), schema);
    if (schema.type === 'worldPortal') continue; // created from the world library, not blank
    assert.equal(schema.create().type, schema.type);
    for (const field of schema.fields) assert.ok(field.key && field.label);
  }
  assert.ok(addableComponents(true).length > addableComponents(false).length);
  assert.ok(!addableComponents(true).some((s) => s.type === 'worldPortal'));
});

test('history undoes, redoes and coalesces keyed edits', () => {
  let t = 0;
  const history = new History(50, 800, () => t);
  history.record('a', 'name');
  t = 100;
  history.record('ab', 'name'); // coalesced into the previous step
  t = 200;
  history.record('abc'); // new step
  assert.equal(history.undo('abcd'), 'abc');
  assert.equal(history.undo('abc'), 'a');
  assert.equal(history.undo('a'), undefined);
  assert.equal(history.redo('a'), 'abc');
  history.record('x');
  assert.equal(history.canRedo, false);
});

test('lintCode ignores brackets in strings and comments and reports real problems', async () => {
  const { lintCode, findBracketProblem } = await import('../src/lib/studio/lint/code.ts');
  const ok = "// ( not a bracket\nreturn { onSpawn() { ctx.log(')'); } };";
  assert.deepEqual(lintCode(ok), []);
  assert.equal(findBracketProblem('return {\n  tick() {\n  }\n'.trimEnd()).line, 1);
  assert.equal(findBracketProblem('a(]').line, 1);
  assert.equal(lintCode('return { tick( };')[0].severity, 'error');
  assert.equal(lintCode('return { onSpawn() { window.alert(1); } };')[0].line, 1);
  assert.equal(lintCode('const x = 1;')[0].severity, 'warning');
});
