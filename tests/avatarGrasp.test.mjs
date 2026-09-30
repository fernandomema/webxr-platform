import test from 'node:test';
import assert from 'node:assert/strict';
import { signedDistance, solveFinger, solveGrasp, fingerJoints, defaultHandModel, holdingBends } from '../src/lib/xr/avatar/grasp.ts';

const I = [0, 0, 0, 1];
const box = (center, half) => ({ kind: 'box', center, rotation: I, half });
const cylinder = (center, radius, halfHeight, rotation = I) => ({ kind: 'cylinder', center, rotation, half: [radius, halfHeight, radius] });

test('signed distance is negative inside, zero on the surface and grows outside', () => {
	assert.ok(signedDistance(box([0, 0, 0], [1, 1, 1]), [0, 0, 0]) < 0);
	assert.ok(Math.abs(signedDistance(box([0, 0, 0], [1, 1, 1]), [1, 0, 0])) < 1e-9);
	assert.ok(Math.abs(signedDistance(box([0, 0, 0], [1, 1, 1]), [3, 0, 0]) - 2) < 1e-9);
	assert.ok(Math.abs(signedDistance({ kind: 'sphere', center: [0, 0, 0], rotation: I, half: [0.5, 0.5, 0.5] }, [0, 2, 0]) - 1.5) < 1e-9);
	assert.ok(Math.abs(signedDistance(cylinder([0, 0, 0], 0.5, 1), [2, 0, 0]) - 1.5) < 1e-9);
	assert.ok(Math.abs(signedDistance(cylinder([0, 0, 0], 0.5, 1), [0, 3, 0]) - 2) < 1e-9);
});

test('a finger that curls freely folds all the way; an obstacle in its way stops it short of the limit', () => {
	const finger = defaultHandModel('right')[2];
	const free = solveFinger(finger, []);
	assert.equal(free.touched, false);
	free.bends.forEach((b, i) => assert.ok(b > finger.maxBend[i] - 0.05));
	// A thick handle held in the palm, under the fingers.
	const handle = cylinder([0, -0.035, 0.07], 0.02, 0.06, [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)]);
	const held = solveFinger(finger, [handle]);
	assert.equal(held.touched, true);
	assert.ok(held.bends[0] < free.bends[0] || held.bends[1] < free.bends[1]);
});

test('the finger never ends up inside the object it grips', () => {
	const finger = defaultHandModel('left')[1];
	const handle = box([0, -0.03, 0.06], [0.05, 0.02, 0.04]);
	const { bends } = solveFinger(finger, [handle]);
	const joints = fingerJoints(finger, bends);
	for (let s = 0; s < 3; s++) for (const t of [0.34, 0.67, 1]) {
		const p = joints[s].map((v, k) => v + (joints[s + 1][k] - v) * t);
		assert.ok(signedDistance(handle, p) >= finger.radius - 1e-6, `segment ${s} at ${t} is inside`);
	}
});

test('a thicker handle leaves the fingers more open than a thin one', () => {
	const finger = defaultHandModel('right')[2];
	const rotate = [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)];
	const total = (r) => solveFinger(finger, [cylinder([0, -0.03 - r, 0.07], r, 0.06, rotate)]).bends.reduce((a, b) => a + b, 0);
	assert.ok(total(0.012) > total(0.03), 'the thin handle lets the finger curl further');
});

test('fingers that never meet the object keep the relaxed hold; those that do wrap it', () => {
	const hand = defaultHandModel('right');
	const relaxed = holdingBends();
	const far = solveGrasp(hand, [box([0, 0.5, 2], [0.02, 0.02, 0.02])], relaxed);
	assert.deepEqual(far, relaxed);
	const near = solveGrasp(hand, [cylinder([0, -0.035, 0.07], 0.02, 0.06, [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)])], relaxed);
	assert.equal(near.length, 15);
	assert.notDeepEqual(near, relaxed);
	assert.deepEqual(solveGrasp(hand, [], relaxed), relaxed);
});

test('a finger that starts inside the object is left to the relaxed hold instead of staying straight', () => {
	const hand = defaultHandModel('right');
	const enveloping = box([0, 0, 0.08], [0.2, 0.2, 0.2]); // the whole hand is inside this
	assert.equal(solveFinger(hand[2], [enveloping]).touched, false);
	assert.deepEqual(solveGrasp(hand, [enveloping], holdingBends()), holdingBends());
});

import { solveThumb, solveGraspFull, withSwing } from '../src/lib/xr/avatar/grasp.ts';

test('a thumb turns across the palm to reach an object its plain curl would miss', () => {
	const thumb = defaultHandModel('right')[0];
	// A bar lying across the palm, off to the side the thumb's own curl plane does not reach.
	const bar = cylinder([0.0, -0.03, 0.09], 0.012, 0.05, [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]);
	const result = solveThumb(thumb, [bar]);
	assert.equal(typeof result.swing, 'number');
	if (result.touched) assert.ok(solveFinger(withSwing(thumb, result.swing), [bar]).touched);
	assert.deepEqual(withSwing(thumb, 0), thumb);
});

test('solveGraspFull reports the thumb swing and leaves an unreachable thumb at rest', () => {
	const hand = defaultHandModel('left');
	const far = solveGraspFull(hand, [box([0, 0.6, 2], [0.02, 0.02, 0.02])], holdingBends());
	assert.deepEqual(far.bends, holdingBends());
	assert.equal(far.thumbSwing, 0);
	const empty = solveGraspFull(hand, [], holdingBends());
	assert.equal(empty.thumbSwing, 0);
});

test('a finger whose knuckle already overlaps the object still wraps it without entering', () => {
	const finger = defaultHandModel('right')[2];
	// A handle pressed against the knuckles: the straight finger overlaps it only at its root.
	const handle = cylinder([0, -0.02, 0.1], 0.015, 0.08, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
	const grasp = solveFinger(finger, [handle]);
	assert.equal(grasp.touched, true);
	const joints = fingerJoints(finger, grasp.bends);
	for (const t of [0.75, 1]) for (let s = 0; s < 3; s++) {
		const p = joints[s].map((v, i) => v + (joints[s + 1][i] - v) * t);
		assert.ok(signedDistance(handle, p) >= finger.radius - 1e-6);
	}
});

test('a finger wraps a handle with all its joints instead of hooking its tip', () => {
	const finger = defaultHandModel('right')[2];
	const handle = cylinder([0, -0.035, 0.07], 0.02, 0.08, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
	const { bends, touched } = solveFinger(finger, [handle]);
	assert.equal(touched, true);
	assert.ok(bends[0] > 0.5 && bends[1] > 0.5, `knuckle ${bends[0]} and middle joint ${bends[1]} both close`);
	// It ends on the surface, not short of it.
	const joints = fingerJoints(finger, bends);
	const gap = Math.min(...[1, 2].flatMap((s) => [0.5, 1].map((t) => signedDistance(handle, joints[s].map((v, i) => v + (joints[s + 1][i] - v) * t)))));
	assert.ok(gap - finger.radius < 0.004, `gap ${gap - finger.radius}`);
});

test('the thumb adapts its pose to the shape it grips', () => {
	const hand = defaultHandModel('right');
	const thin = solveGraspFull(hand, [cylinder([0, -0.03, 0.07], 0.015, 0.06, [0.7071, 0, 0, 0.7071])], holdingBends());
	const thick = solveGraspFull(hand, [box([0, -0.05, 0.07], [0.05, 0.03, 0.05])], holdingBends());
	assert.notDeepEqual(thin.bends.slice(0, 3), thick.bends.slice(0, 3));
});

import { palmShift, shiftPrimitives } from '../src/lib/xr/avatar/grasp.ts';

const sphere = (center, r) => ({ kind: 'sphere', center, rotation: I, half: [r, r, r] });

test('a grabbed object below the palm pulls the hand down onto it, and one sunk into the palm pushes it out', () => {
	const hand = defaultHandModel('right');
	const below = palmShift(hand, [sphere([0, -0.09, 0.06], 0.04)], 0.1);
	assert.ok(below && below[1] < -0.02, `moved down by ${below?.[1]}`);
	const inside = palmShift(hand, [sphere([0, -0.01, 0.06], 0.04)], 0.1);
	assert.ok(inside && inside[1] > 0.02, `moved up by ${inside?.[1]}`);
	for (const [shift, ball] of [[below, sphere([0, -0.09, 0.06], 0.04)], [inside, sphere([0, -0.01, 0.06], 0.04)]]) {
		const grasp = solveGraspFull(hand, shiftPrimitives([ball], shift), holdingBends());
		assert.notDeepEqual(grasp.bends.slice(3, 6), holdingBends().slice(3, 6), 'the index wraps the ball');
	}
});

test('an object out of reach of the palm leaves the hand where it is', () => {
	assert.equal(palmShift(defaultHandModel('left'), [box([0, -0.5, 1], [0.04, 0.04, 0.04])], 0.1), null);
	assert.equal(palmShift(defaultHandModel('left'), [], 0.1), null);
});

test('a handle buried in the fingers is wrapped once the hand is moved off it', () => {
	const hand = defaultHandModel('right');
	const handle = cylinder([0, -0.004, 0.125], 0.02, 0.08, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
	assert.equal(solveFinger(hand[2], [handle]).touched, false);
	const shift = palmShift(hand, [handle], 0.1);
	assert.ok(shift);
	assert.equal(solveFinger(hand[2], shiftPrimitives([handle], shift)).touched, true);
});
