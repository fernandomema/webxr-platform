import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_RANGE } from '../src/lib/xr/interaction/pushPull.ts';
import {
	MAX_PITCH,
	fitPanel,
	lookedAt,
	pieIndexAt,
	pieOffset,
	viewSizeAt,
	wheelNotches,
	wheelPushedDistance,
	wheelScaledBy,
	SCALE_RANGE
} from '../src/lib/xr/interaction/desktop/desktopMath.ts';

test('the mouse turns the view, and the pitch stops short of straight up or down', () => {
	const turned = lookedAt({ yaw: 0, pitch: 0 }, 100, 0, 1, false);
	assert.ok(turned.yaw > 0 && turned.pitch === 0);
	assert.equal(lookedAt({ yaw: 0, pitch: 0 }, 0, 100000, 1, false).pitch, MAX_PITCH);
	assert.equal(lookedAt({ yaw: 0, pitch: 0 }, 0, -100000, 1, false).pitch, -MAX_PITCH);
});

test('sensitivity scales the turn and inverting flips only the pitch', () => {
	const slow = lookedAt({ yaw: 0, pitch: 0 }, 50, 50, 0.5, false);
	const fast = lookedAt({ yaw: 0, pitch: 0 }, 50, 50, 2, false);
	assert.ok(Math.abs(fast.yaw - slow.yaw * 4) < 1e-9);
	const inverted = lookedAt({ yaw: 0, pitch: 0 }, 50, 50, 1, true);
	const normal = lookedAt({ yaw: 0, pitch: 0 }, 50, 50, 1, false);
	assert.equal(inverted.yaw, normal.yaw);
	assert.ok(Math.abs(inverted.pitch + normal.pitch) < 1e-12);
});

test('a panel fills the view but keeps its shape, whichever side limits it', () => {
	const wide = fitPanel(2, 1, 1.5);
	assert.ok(Math.abs(wide.height - 0.94) < 1e-9, 'a wide view is limited by its height');
	assert.ok(Math.abs(wide.width / wide.height - 1.5) < 1e-9);
	const tall = fitPanel(1, 2, 1.5);
	assert.ok(Math.abs(tall.width - 0.94) < 1e-9, 'a tall view is limited by its width');
	assert.ok(Math.abs(tall.width / tall.height - 1.5) < 1e-9);
});

test('the view size at a distance follows the field of view', () => {
	const size = viewSizeAt(1, Math.PI / 2, 2);
	assert.ok(Math.abs(size.height - 2) < 1e-9);
	assert.ok(Math.abs(size.width - 4) < 1e-9);
});

test('the wheel pushes away when turned away from you and brings closer when turned toward you', () => {
	assert.ok(wheelPushedDistance(2, wheelNotches(-100)) > 2);
	assert.ok(wheelPushedDistance(2, wheelNotches(100)) < 2);
	assert.equal(wheelPushedDistance(2, 0), 2);
});

test('a held object moves faster the further it is, and stays between the hand and the far limit', () => {
	const near = wheelPushedDistance(1, 1) - 1;
	const far = wheelPushedDistance(8, 1) - 8;
	assert.ok(far > near * 2);
	assert.equal(wheelPushedDistance(0.2, -50), PUSH_RANGE.min);
	assert.equal(wheelPushedDistance(14, 50), PUSH_RANGE.max);
});

test('scaling by the wheel is a share per notch and stays inside its range', () => {
	assert.ok(Math.abs(wheelScaledBy(1, 1) - 1.1) < 1e-9);
	assert.ok(wheelScaledBy(1, -1) < 1);
	assert.ok(Math.abs(1 * wheelScaledBy(1, 1000) - SCALE_RANGE.max) < 1e-9);
	assert.ok(Math.abs(1 * wheelScaledBy(1, -1000) - SCALE_RANGE.min) < 1e-9);
});

test('the radial menu picks the slice the pointer is on, clockwise from the top', () => {
	assert.equal(pieIndexAt(0.1, 0.1, 4, 0.4), -1, 'near the centre nothing is picked');
	assert.equal(pieIndexAt(0, -1, 4, 0.4), 0, 'up is the first slice');
	assert.equal(pieIndexAt(1, 0, 4, 0.4), 1, 'right is the second');
	assert.equal(pieIndexAt(0, 1, 4, 0.4), 2, 'down is the third');
	assert.equal(pieIndexAt(-1, 0, 4, 0.4), 3, 'left is the fourth');
	assert.equal(pieIndexAt(-0.05, -1, 5, 0.4), 0, 'a little left of up is still the first of five');
	assert.equal(pieIndexAt(1, 1, 0, 0.4), -1, 'no slices, nothing to pick');
});

test('the radial pointer is pushed by the mouse and held inside the ring', () => {
	const moved = pieOffset({ x: 0, y: 0 }, 45, 0, 90);
	assert.ok(Math.abs(moved.x - 0.5) < 1e-9 && moved.y === 0);
	const far = pieOffset({ x: 0, y: 0 }, 9000, 9000, 90, 1.25);
	assert.ok(Math.abs(Math.hypot(far.x, far.y) - 1.25) < 1e-9);
});
