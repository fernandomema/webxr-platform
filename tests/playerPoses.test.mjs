import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeleportTarget, rotateVector, viewPlayerPose, viewPose } from '../src/lib/xr/playerPoses.ts';

const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);
const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

test('a pose with no rotation points along +Z, with +Y up and +X to its right', () => {
	const view = viewPose({ position: [1, 2, 3], rotation: [0, 0, 0, 1] });
	assert.deepEqual(view.position, [1, 2, 3]);
	assert.ok(near(view.forward, [0, 0, 1]) && near(view.up, [0, 1, 0]) && near(view.right, [1, 0, 0]));
});

test('turning a quarter to the right (yaw 90 degrees) makes the pose look along +X', () => {
	const view = viewPose({ position: [0, 0, 0], rotation: yawQuat(Math.PI / 2) });
	assert.ok(near(view.forward, [1, 0, 0]), `forward ${view.forward}`);
	assert.ok(near(view.right, [0, 0, -1]), `right ${view.right}`);
	assert.ok(near(view.up, [0, 1, 0]));
});

test('looking up by 30 degrees tilts forward upwards and keeps the three directions at right angles', () => {
	const pitch = -Math.PI / 6; // a negative rotation about +X lifts +Z
	const view = viewPose({ position: [0, 0, 0], rotation: [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)] });
	assert.ok(view.forward[1] > 0.49 && view.forward[1] < 0.51, `forward ${view.forward}`);
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	assert.ok(Math.abs(dot(view.forward, view.up)) < 1e-9 && Math.abs(dot(view.forward, view.right)) < 1e-9);
});

test('a rotation that is not quite a unit quaternion is normalised, so the directions stay unit length', () => {
	const view = viewPose({ position: [0, 0, 0], rotation: [0, 0.8, 0, 0.8] });
	assert.ok(Math.abs(Math.hypot(...view.forward) - 1) < 1e-9);
	assert.ok(Math.abs(Math.hypot(...view.rotation) - 1) < 1e-9);
});

test('the view copies the position, so a script that changes it does not change the avatar', () => {
	const input = { position: [1, 2, 3], rotation: [0, 0, 0, 1] };
	viewPose(input).position[0] = 99;
	assert.deepEqual(input.position, [1, 2, 3]);
});

test('a desktop player has a head and no hands; a headset player has both', () => {
	const head = { position: [0, 1.6, 0], rotation: [0, 0, 0, 1] };
	assert.deepEqual(Object.keys(viewPlayerPose({ head })), ['head']);
	const both = viewPlayerPose({ head, left: head, right: head });
	assert.deepEqual(Object.keys(both).sort(), ['head', 'left', 'right']);
});

test('rotateVector rotates by the quaternion and leaves a vector on the axis alone', () => {
	assert.ok(near(rotateVector(yawQuat(Math.PI), [0, 0, 1]), [0, 0, -1]));
	assert.ok(near(rotateVector(yawQuat(1.234), [0, 5, 0]), [0, 5, 0]));
});

test('a teleport target must be a finite position inside the limits, with a finite yaw if it has one', () => {
	assert.deepEqual(parseTeleportTarget({ position: [400, 0, 12], yaw: 1.5 }), { position: [400, 0, 12], yaw: 1.5 });
	assert.deepEqual(parseTeleportTarget({ position: [0, 0, 0] }), { position: [0, 0, 0] });
	for (const bad of [null, undefined, 5, {}, { position: [1, 2] }, { position: [1, 2, NaN] }, { position: [1, 2, Infinity] }, { position: [1e9, 0, 0] }, { position: ['1', 2, 3] }, { position: [0, 0, 0], yaw: NaN }, { position: [0, 0, 0], yaw: '1' }]) {
		assert.equal(parseTeleportTarget(bad), null, JSON.stringify(bad));
	}
});
