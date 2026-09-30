import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { multiplyQuat, worldPose, localPose, findPreviewCamera, conjugateQuat, DEFAULT_PREVIEW_FOV_DEG } from '../src/lib/xr/thumbnail/cameraPose.ts';
import { rotateVector } from '../src/lib/xr/avatar/ik.ts';

const near = (a, b, eps = 1e-6) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < eps), `${a} vs ${b}`);
const yaw = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const slot = (id, parentId, position, rotation = [0, 0, 0, 1], scale = [1, 1, 1], components = []) => ({ id, parentId, name: id, position, rotation, scale, components });

test('multiplyQuat is Babylon’s multiply: the second rotation is applied first', () => {
	const a = Quaternion.RotationAxis(new Vector3(0, 1, 0), 0.7).asArray();
	const b = Quaternion.RotationAxis(new Vector3(1, 0, 0), 1.1).asArray();
	near(multiplyQuat(a, b), Quaternion.FromArray(a).multiply(Quaternion.FromArray(b)).asArray());
});

test('a nested slot’s world pose composes its parents’ position, rotation and scale', () => {
	const tree = [slot('group', null, [10, 0, 0], yaw(Math.PI / 2), [2, 2, 2]), slot('cam', 'group', [0, 1, 1])];
	const pose = worldPose(tree, 'cam');
	// scaled by 2 -> (0,2,2); yaw 90 degrees turns +Z onto +X -> (2,2,0); then the group's position.
	near(pose.position, [12, 2, 0]);
	near(rotateVector(pose.rotation, [0, 0, 1]), [1, 0, 0]);
	assert.equal(worldPose(tree, 'missing'), null);
});

test('localPose undoes worldPose, so a camera moved to a world pose lands there whatever its parent', () => {
	const tree = [slot('group', null, [3, 1, -2], yaw(0.8), [1.5, 1.5, 1.5]), slot('cam', 'group', [0, 0, 0])];
	const wanted = { position: [4, 2, 5], rotation: yaw(-0.4) };
	const local = localPose(tree, 'group', wanted);
	const placed = worldPose([tree[0], { ...tree[1], position: local.position, rotation: local.rotation }], 'cam');
	near(placed.position, wanted.position, 1e-9);
	near(placed.rotation, wanted.rotation, 1e-9);
	near(localPose(tree, null, wanted).position, wanted.position);
	near(multiplyQuat(conjugateQuat(yaw(0.5)), yaw(0.5)), [0, 0, 0, 1]);
});

test('the preview camera is found wherever it sits, with its field of view clamped and defaulted', () => {
	assert.equal(findPreviewCamera([slot('a', null, [0, 0, 0])]), null);
	const found = findPreviewCamera([slot('root', null, [1, 0, 0]), slot('cam', 'root', [0, 2, 0], undefined, undefined, [{ type: 'previewCamera' }])]);
	assert.equal(found.slotId, 'cam');
	near(found.position, [1, 2, 0]);
	assert.ok(Math.abs(found.fov - (DEFAULT_PREVIEW_FOV_DEG * Math.PI) / 180) < 1e-9);
	assert.ok(Math.abs(findPreviewCamera([slot('c', null, [0, 0, 0], undefined, undefined, [{ type: 'previewCamera', fov: 500 }])]).fov - (110 * Math.PI) / 180) < 1e-9);
});

import { lookRotation } from '../src/lib/xr/thumbnail/cameraPose.ts';

test('a slot that looks somewhere has its forward axis pointing there, its head up, and stays upright', () => {
	const dir = [-2, -1, 2.5];
	const length = Math.hypot(...dir);
	const forward = dir.map((v) => v / length);
	const q = lookRotation(forward);
	near(rotateVector(q, [0, 0, 1]), forward);
	const up = rotateVector(q, [0, 1, 0]);
	assert.ok(up[1] > 0.5, 'the head is still up');
	near([rotateVector(q, [1, 0, 0])[1]], [0], 1e-9); // no roll: its right side stays level
	near(lookRotation([0, 0, 1]), [0, 0, 0, 1]);
	near(rotateVector(lookRotation([0, 1, 0]), [0, 0, 1]), [0, 1, 0]);
	near(rotateVector(lookRotation([0, -1, 0]), [0, 0, 1]), [0, -1, 0]);
});
