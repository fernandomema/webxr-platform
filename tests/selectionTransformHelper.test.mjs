import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { FreeCamera, NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';

const source = await readFile(new URL('../src/lib/studio/selectionTransformHelper.ts', import.meta.url), 'utf8');
const snappingSource = await readFile(new URL('../src/lib/studio/transformSnapping.ts', import.meta.url), 'utf8');
const snappingCode = ts.transpileModule(snappingSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const snappingUrl = `data:text/javascript;base64,${Buffer.from(snappingCode).toString('base64')}`;
const { bindTransformSnapping } = await import(snappingUrl);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
 .replaceAll("'./transformSnapping'", JSON.stringify(snappingUrl))
 .replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core')));
const { SelectionTransformHelper } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture() {
 const engine = new NullEngine();
 const scene = new Scene(engine);
 const camera = new FreeCamera('editor', new Vector3(0, 0, -5), scene);
 let detached = 0, attached = 0;
 camera.detachControl = () => detached++;
 camera.attachControl = () => attached++;
 const parent = new TransformNode('parent', scene);
 parent.position.set(4, 5, 6); parent.scaling.set(2, 2, 2);
 parent.rotationQuaternion = Quaternion.FromEulerAngles(0, 0.4, 0);
 const node = new TransformNode('selected', scene); node.parent = parent;
 const nodes = new Map([['selected', node]]), changes = [];
 const helper = new SelectionTransformHelper(scene, {}, camera, {
  getNode: (id) => nodes.get(id), onChanged: (...args) => changes.push(args)
 });
 return { helper, node, nodes, changes, controls: () => ({ detached, attached }), dispose() { helper.dispose(); scene.dispose(); engine.dispose(); } };
}

test('all three modes edit the selected slot and commit one local transform per drag', () => {
 const f = fixture();
 try {
  assert.equal(f.helper.recentlyDragged(), false);
  for (const [index, mode] of ['move', 'rotate', 'scale'].entries()) {
   f.helper.update('selected', mode);
   const manager = f.helper.gizmos;
   assert.equal(manager.positionGizmoEnabled, mode === 'move');
   assert.equal(manager.rotationGizmoEnabled, mode === 'rotate');
   assert.equal(manager.scaleGizmoEnabled, mode === 'scale');
   assert.equal(manager.attachedNode, f.node);
   const gizmo = manager.gizmos[`${mode === 'move' ? 'position' : mode === 'rotate' ? 'rotation' : 'scale'}Gizmo`];
   gizmo.onDragStartObservable.notifyObservers({});
   assert.equal(f.helper.isDragging(), true);
   assert.equal(f.changes.length, index, 'no document write during the drag');
   f.node.position.set(1, 2, 3); f.node.scaling.set(0.5, 2, 3);
   f.node.rotationQuaternion = Quaternion.FromEulerAngles(0.1, 0.2, 0.3);
   gizmo.onDragEndObservable.notifyObservers({});
   assert.equal(f.helper.isDragging(), false);
   assert.equal(f.changes.length, index + 1);
   assert.deepEqual(f.changes[index], ['selected', [1, 2, 3], f.node.rotationQuaternion.asArray(), [0.5, 2, 3]]);
   assert.equal(f.helper.recentlyDragged(), true);
  }
  assert.deepEqual(f.controls(), { detached: 3, attached: 3 });
  f.helper.update(null, 'move');
  assert.equal(f.helper.gizmos.attachedNode, null);
  assert.equal(f.helper.gizmos.positionGizmoEnabled, false);
 } finally { f.dispose(); }
});

test('changing selection during a drag cannot write its transform to another slot', () => {
 const f = fixture();
 try {
  f.helper.update('selected', 'move');
  const gizmo = f.helper.gizmos.gizmos.positionGizmo;
  gizmo.onDragStartObservable.notifyObservers({});
  f.helper.update(null, 'move');
  gizmo.onDragEndObservable.notifyObservers({});
  assert.deepEqual(f.changes, []);
  assert.equal(f.helper.isDragging(), false);
 } finally { f.dispose(); }
});

test('rotation rings rotate a non-uniformly scaled node and commit the result', () => {
 const f = fixture();
 try {
  f.node.scaling.set(1.9, 2.676, 1);
  f.node.rotationQuaternion = Quaternion.Identity();
  f.node.computeWorldMatrix(true);
  f.helper.update('selected', 'rotate');
  const ring = f.helper.gizmos.gizmos.rotationGizmo.yGizmo;
  const center = f.node.getAbsolutePosition().clone();
  const before = f.node.rotationQuaternion.clone();
  ring.dragBehavior.onDragStartObservable.notifyObservers({ dragPlanePoint: center.add(new Vector3(1, 0, 0)) });
  ring.dragBehavior.onDragObservable.notifyObservers({ dragPlanePoint: center.add(new Vector3(0, 0, 1)) });
  ring.dragBehavior.onDragEndObservable.notifyObservers({});
  assert.ok(!f.node.rotationQuaternion.equalsWithEpsilon(before), 'the ring must actually change rotation');
  assert.equal(f.changes.length, 1);
  assert.deepEqual(f.changes[0][2], f.node.rotationQuaternion.asArray());
  assert.ok(f.node.scaling.equalsWithEpsilon(new Vector3(1.9, 2.676, 1)));
 } finally { f.dispose(); }
});

test('Shift toggles snapping for every mode and blur resets it', () => {
 const f = fixture();
 const target = new EventTarget();
 let precision = 'medium';
 const unbind = bindTransformSnapping(f.node.getScene(), f.helper.gizmos, target, () => precision);
 const send = (type, shiftKey) => { const event = new Event(type); event.shiftKey = shiftKey; target.dispatchEvent(event); };
 try {
  send('keydown', true);
  for (const [mode, name, step] of [['move', 'positionGizmo', 0.1], ['rotate', 'rotationGizmo', Math.PI / 12], ['scale', 'scaleGizmo', 0.1]]) {
   f.helper.update('selected', mode);
   send('pointermove', true);
   assert.equal(f.helper.gizmos.gizmos[name].snapDistance, step);
   send('keyup', false);
   assert.equal(f.helper.gizmos.gizmos[name].snapDistance, 0);
   send('keydown', true);
  }
  assert.equal(f.helper.gizmos.gizmos.scaleGizmo.incrementalSnap, true);
  for (const [level, move, degrees, scale] of [['fine', 0.01, 1, 0.01], ['coarse', 0.5, 45, 0.5]]) {
   precision = level;
   f.node.getScene().onBeforeRenderObservable.notifyObservers(f.node.getScene());
   assert.equal(f.helper.gizmos.gizmos.positionGizmo.snapDistance, move);
   assert.equal(f.helper.gizmos.gizmos.rotationGizmo.snapDistance, degrees * Math.PI / 180);
   assert.equal(f.helper.gizmos.gizmos.scaleGizmo.snapDistance, scale);
  }
  target.dispatchEvent(new Event('blur'));
  for (const gizmo of Object.values(f.helper.gizmos.gizmos)) if (gizmo && 'snapDistance' in gizmo) assert.equal(gizmo.snapDistance, 0);
  unbind();
  send('keydown', true);
  assert.equal(f.helper.gizmos.gizmos.scaleGizmo.snapDistance, 0);
 } finally { unbind(); f.dispose(); }
});
