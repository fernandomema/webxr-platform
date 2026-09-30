import test from 'node:test';
import assert from 'node:assert/strict';
import { stepFoot, newFoot, smoothVelocity, DEFAULT_GAIT } from '../src/lib/xr/avatar/gait.ts';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('a body standing still never moves its feet', () => {
	let foot = newFoot([0.1, 0, 0]);
	for (let i = 0; i < 100; i++) foot = stepFoot(foot, [0.1, 0, 0], [0, 0, 0], false, 0.016);
	assert.deepEqual(foot.position, [0.1, 0, 0]);
	assert.equal(foot.stepping, false);
});

test('a small drift stays planted; a large one triggers a step that lifts and lands ahead of the body', () => {
	let foot = newFoot([0, 0, 0]);
	foot = stepFoot(foot, [0, 0, 0.1], [0, 0, 0], false, 0.016);
	assert.equal(foot.stepping, false);
	foot = stepFoot(foot, [0, 0, 0.3], [0, 0, 1.5], false, 0.016);
	assert.equal(foot.stepping, true);
	let peak = 0;
	for (let i = 0; i < 60 && foot.stepping; i++) {
		foot = stepFoot(foot, [0, 0, 0.3], [0, 0, 1.5], false, 0.016);
		peak = Math.max(peak, foot.position[1]);
	}
	assert.ok(peak > 0.05 && peak <= DEFAULT_GAIT.lift + 1e-6, `lifted ${peak}`);
	assert.equal(foot.stepping, false);
	assert.ok(foot.position[2] > 0.3, 'landed ahead of where the body was');
	assert.equal(foot.position[1], 0);
});

test('two feet walking alongside a moving body alternate and never both swing at once', () => {
	const speed = 1.4;
	let left = newFoot([-0.09, 0, 0]), right = newFoot([0.09, 0, 0]);
	let bothInAir = 0, leftSteps = 0, rightSteps = 0, maxGap = 0;
	for (let i = 0; i < 600; i++) {
		const z = (i * 0.016) * speed;
		const wasL = left.stepping, wasR = right.stepping;
		left = stepFoot(left, [-0.09, 0, z], [0, 0, speed], right.stepping, 0.016);
		right = stepFoot(right, [0.09, 0, z], [0, 0, speed], left.stepping, 0.016);
		if (left.stepping && right.stepping) bothInAir++;
		if (left.stepping && !wasL) leftSteps++;
		if (right.stepping && !wasR) rightSteps++;
		maxGap = Math.max(maxGap, dist(left.position, [-0.09, 0, z]), dist(right.position, [0.09, 0, z]));
	}
	assert.equal(bothInAir, 0);
	assert.ok(leftSteps > 5 && rightSteps > 5, `steps ${leftSteps}/${rightSteps}`);
	assert.ok(Math.abs(leftSteps - rightSteps) <= 2, 'they take turns');
	assert.ok(maxGap < 0.6, `feet stay near the body (${maxGap})`);
});

test('a teleport puts the feet straight back under the body', () => {
	const foot = stepFoot(newFoot([0, 0, 0]), [5, 0, 5], [0, 0, 0], false, 0.016);
	assert.deepEqual(foot.position, [5, 0, 5]);
	assert.equal(foot.stepping, false);
});

test('velocity is measured on the floor plane and eased', () => {
	const v = smoothVelocity([0, 0, 0], [0, 1.6, 0], [0, 1.7, 0.05], 0.05);
	assert.equal(v[1], 0);
	assert.ok(v[2] > 0 && v[2] < 1);
	assert.deepEqual(smoothVelocity([1, 0, 1], [0, 0, 0], [5, 0, 5], 0), [1, 0, 1]);
});
