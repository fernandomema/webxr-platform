import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateVector, headYaw, followYaw, restFacingYaw, yawQuat, updateStandingHeight, solveTwoBone, arcBetween, stepToReach } from '../src/lib/xr/avatar/ik.ts';

const near = (a, b, eps = 1e-4) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < eps), `${a} vs ${b}`);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pitch = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

test('a positive yaw turns +Z towards +X (Babylon convention)', () => {
	near(rotateVector(yawQuat(Math.PI / 2), [0, 0, 1]), [1, 0, 0]);
	near(rotateVector(yawQuat(Math.PI), [0, 0, 1]), [0, 0, -1]);
});

test('headYaw reads the facing direction, also when looking steeply up or down', () => {
	assert.ok(Math.abs(headYaw([0, 0, 0, 1])) < 1e-6);
	assert.ok(Math.abs(headYaw(yawQuat(1)) - 1) < 1e-6);
	// Pitch +80 degrees about X looks down in Babylon; the body should still face where the head was pointing.
	const down = headYaw(pitch(1.4));
	assert.ok(Math.abs(down) < 1e-6, `looking down while facing +Z keeps yaw 0, got ${down}`);
	const up = headYaw(pitch(-1.4));
	assert.ok(Math.abs(up) < 1e-6, `looking up while facing +Z keeps yaw 0, got ${up}`);
});

test('followYaw eases towards the target by the shortest way round', () => {
	const next = followYaw(3.0, -3.0, 0.1);
	assert.ok(next > 3.0 && next < Math.PI + 0.2, 'crosses the +/-PI seam instead of swinging the long way');
	assert.ok(Math.abs(followYaw(0, 0.1, 0.016)) < 0.1, 'a small head turn barely moves the body');
});

test('restFacingYaw flips a model that faces -Z', () => {
	assert.equal(restFacingYaw(-0.5, 0.5), 0);
	assert.equal(restFacingYaw(0.5, -0.5), Math.PI);
});

test('standing height rises at once and sags only slowly', () => {
	assert.equal(updateStandingHeight(1.5, 1.7, 0.016), 1.7);
	const crouched = updateStandingHeight(1.7, 0.9, 0.016);
	assert.ok(crouched > 1.69 && crouched < 1.7);
	assert.equal(updateStandingHeight(1.5, 9, 0.016), 2.3);
});

test('solveTwoBone keeps both bones at their length and reaches a reachable target', () => {
	const root = [0, 1.4, 0];
	const target = [0.3, 1.2, 0.3];
	const { mid, end } = solveTwoBone(root, target, 0.3, 0.3, [0, -0.2, -1]);
	near(end, target);
	assert.ok(Math.abs(dist(root, mid) - 0.3) < 1e-4);
	assert.ok(Math.abs(dist(mid, end) - 0.3) < 1e-4);
	assert.ok(mid[2] < target[2], 'the elbow bends towards the pole (behind)');
});

test('solveTwoBone stretches straight towards an unreachable target', () => {
	const { mid, end } = solveTwoBone([0, 0, 0], [0, 0, 5], 0.3, 0.3, [0, 1, 0]);
	assert.ok(Math.abs(dist([0, 0, 0], end) - 0.6) < 1e-3);
	assert.ok(end[2] > 0.59);
	assert.ok(Math.abs(dist([0, 0, 0], mid) - 0.3) < 1e-3);
});

test('arcBetween rotates one direction onto another', () => {
	const q = arcBetween([1, 0, 0], [0, 1, 0]);
	near(rotateVector(q, [1, 0, 0]), [0, 1, 0]);
	near(rotateVector(arcBetween([0, 0, 1], [0, 0, -1]), [0, 0, 1]), [0, 0, -1]);
	near(arcBetween([0, 1, 0], [0, 1, 0]), [0, 0, 0, 1]);
});

test('stepToReach moves a shoulder forward just enough to reach a target, and not at all when it already can', () => {
	assert.equal(stepToReach([0, 0, 0.4], [0, 0, 1], 0.5), 0);
	assert.equal(stepToReach([0, 0, -0.8], [0, 0, 1], 0.5), 0, 'a target behind is not helped by moving forward');
	const step = stepToReach([0.2, -0.3, 0.6], [0, 0, 1], 0.5);
	assert.ok(step > 0);
	assert.ok(Math.abs(Math.hypot(0.2, -0.3, 0.6 - step) - 0.5) < 1e-9, 'the target ends exactly at arm\'s length');
	assert.equal(stepToReach([0, 0.9, 0.1], [0, 0, 1], 0.5), Infinity, 'too far above to reach by moving forward');
});
