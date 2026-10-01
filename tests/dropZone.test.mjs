import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rotateVector } from '../src/lib/xr/avatar/ik.ts';
import { alignedRotation, boundsCenter, isInsideZone, multiply, settleInZone, worldCorners } from '../src/lib/xr/interaction/dropZoneMath.ts';
import { reduceDocOp } from '../src/lib/studio/state/docOps.ts';
import * as ops from '../src/lib/studio/tree/ops.ts';

const near = (actual, expected, message, epsilon = 1e-6) => {
  for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < epsilon, `${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
};

const IDENTITY = [0, 0, 0, 1];
const turn = (axis, degrees) => {
  const half = (degrees * Math.PI) / 360;
  return [axis[0] * Math.sin(half), axis[1] * Math.sin(half), axis[2] * Math.sin(half), Math.cos(half)];
};
/** A 1 m cube whose pivot is at its middle. */
const cube = (position, rotation = IDENTITY, half = 0.5) => ({
  position,
  rotation,
  localCorners: [-half, half].flatMap((x) => [-half, half].flatMap((y) => [-half, half].map((z) => [x, y, z])))
});
const table = { center: [0, 1, 0], rotation: IDENTITY, size: [2, 0.4, 2] }; // floor at y = 0.8
const UPRIGHT = { align: 'upright', yawStep: 0 };

test('quaternion multiplication agrees with applying the rotations one after the other', () => {
  const a = turn([0, 1, 0], 40);
  const b = turn([1, 0, 0], 70);
  near(rotateVector(multiply(a, b), [0.3, 0.5, 0.2]), rotateVector(a, rotateVector(b, [0.3, 0.5, 0.2])), 'a after b');
});

test('a point is inside the box only within its half sizes, whatever the box is turned to', () => {
  assert.equal(isInsideZone(table, [0.9, 1.19, -0.9]), true);
  assert.equal(isInsideZone(table, [1.1, 1, 0]), false);
  assert.equal(isInsideZone(table, [0, 1.3, 0]), false);
  const sideways = { center: [0, 1, 0], rotation: turn([0, 0, 1], 90), size: [2, 0.4, 2] }; // its 0.4 side now runs along x
  assert.equal(isInsideZone(sideways, [0.19, 1.9, 0]), true);
  assert.equal(isInsideZone(sideways, [0.5, 1, 0]), false);
});

test('an object let go above the floor comes down until its lowest point touches it, without moving sideways', () => {
  const settled = settleInZone(table, cube([0.3, 1.1, -0.2]), UPRIGHT);
  near(settled.position, [0.3, 1.3, -0.2], 'a cube centred half a metre above the floor'); // floor 0.8 + half 0.5
});

test('an object that sank below the floor is lifted onto it', () => {
  near(settleInZone(table, cube([0, 0.9, 0]), UPRIGHT).position, [0, 1.3, 0], 'lifted');
});

test('the bottom is measured from the object parts, not from its pivot', () => {
  // Pivot at the top of a 0.2 m tall object: its parts reach 0.2 below the pivot.
  const hanging = { position: [0, 1.1, 0], rotation: IDENTITY, localCorners: [[-0.1, -0.2, -0.1], [0.1, 0, 0.1]] };
  near(settleInZone(table, hanging, UPRIGHT).position, [0, 1.0, 0], 'pivot 0.2 above the floor');
});

test('a tipped object stands upright again and rests on its new lowest point', () => {
  const tipped = cube([0, 1.1, 0], turn([0, 0, 1], 30), 0.25);
  const settled = settleInZone(table, tipped, UPRIGHT);
  near(rotateVector(settled.rotation, [0, 1, 0]), [0, 1, 0], 'its up points up');
  near(settled.position, [0, 0.8 + 0.25, 0], 'a 0.5 m cube sits on the floor');
});

test('upright keeps the way the object faces', () => {
  const faced = turn([0, 1, 0], 65);
  const tipped = multiply(turn([1, 0, 0], 20), faced);
  const rotation = alignedRotation(table, tipped, UPRIGHT);
  near(rotateVector(rotation, [0, 1, 0]), [0, 1, 0], 'up');
  const forward = rotateVector(rotation, [0, 0, 1]);
  assert.ok(Math.abs(Math.atan2(forward[0], forward[2]) - (65 * Math.PI) / 180) < 0.2, 'it still faces about the same way');
});

test('nearest face rests an object lying on its side without standing it up', () => {
  const onItsSide = turn([0, 0, 1], 80); // its +X is almost up
  const rotation = alignedRotation(table, onItsSide, { align: 'nearest', yawStep: 0 });
  const upAxis = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].find((axis) => rotateVector(rotation, axis)[1] > 0.999);
  assert.ok(upAxis, 'one of its faces points straight up');
  assert.notDeepEqual(upAxis, [0, 1, 0], 'it was not stood on its feet');
});

test('keep leaves the rotation alone but still sets the object down', () => {
  const tipped = turn([0, 0, 1], 30);
  const settled = settleInZone(table, cube([0, 1.1, 0], tipped, 0.25), { align: 'keep', yawStep: 0 });
  assert.deepEqual(settled.rotation, tipped);
});

test('turn snap rounds the heading to the chosen steps', () => {
  const rotation = alignedRotation(table, turn([0, 1, 0], 100), { align: 'upright', yawStep: 90 });
  const forward = rotateVector(rotation, [0, 0, 1]);
  near(forward, [1, 0, 0], 'turned 100° snaps to 90°');
  const other = alignedRotation(table, turn([0, 1, 0], -20), { align: 'upright', yawStep: 90 });
  near(rotateVector(other, [0, 0, 1]), [0, 0, 1], '−20° snaps back to 0°');
});

test('a zone that is itself turned lays the object on its own floor', () => {
  const wall = { center: [0, 1, 0], rotation: turn([1, 0, 0], 90), size: [1, 0.2, 1] }; // its up now points along -z... rotated about x
  const up = rotateVector(wall.rotation, [0, 1, 0]);
  const settled = settleInZone(wall, cube([0, 1, 0.01], IDENTITY, 0.1), UPRIGHT);
  near(rotateVector(settled.rotation, [0, 1, 0]), up, 'its up follows the zone');
  const corners = worldCorners(cube([0, 0, 0], IDENTITY, 0.1), settled.position, settled.rotation);
  const lowest = Math.min(...corners.map((c) => c[0] * up[0] + c[1] * up[1] + c[2] * up[2]));
  const floor = wall.center[0] * up[0] + wall.center[1] * up[1] + wall.center[2] * up[2] - 0.1;
  assert.ok(Math.abs(lowest - floor) < 1e-6, 'resting on the zone’s floor');
});

test('the middle of an object is the middle of its bounds', () => {
  const object = { position: [0, 0, 0], rotation: IDENTITY, localCorners: [[0, 0, 0], [0.4, 0.2, 0.2]] };
  near(boundsCenter(object), [0.2, 0.1, 0.1], 'centre');
  near(boundsCenter({ position: [1, 2, 3], rotation: IDENTITY, localCorners: [] }), [1, 2, 3], 'pivot when there are no parts');
});

test('a drop zone on a slot that is already something goes on a child slab of its own', () => {
  let tree = ops.addSlot([], null, { id: 'table', name: 'Table', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }] }).tree;
  const result = reduceDocOp(tree, { op: 'addComponent', id: 'table', type: 'dropZone', nonce: 'n' });
  assert.equal(ops.getSlot(result.tree, 'table').components.length, 1, 'the table keeps only its own components');
  const child = ops.getSlot(result.tree, result.selectId);
  assert.equal(child.parentId, 'table');
  assert.equal(child.components[0].type, 'dropZone');
  assert.ok(child.scale[1] < child.scale[0], 'it starts as a flat slab');
  const leaf = ops.addSlot([], null, { id: 'empty', name: 'Empty' }).tree;
  assert.equal(reduceDocOp(leaf, { op: 'addComponent', id: 'empty', type: 'dropZone' }).selectId, undefined);
});
