import test from 'node:test';
import assert from 'node:assert/strict';
import { controllerCurls, jointChainCurl, FULL_BEND, handFrameFromKnuckles, quatFromBasis, parseCurls, easeCurls, gripToHandRoll } from '../src/lib/xr/avatar/fingers.ts';
import { rotateVector } from '../src/lib/xr/avatar/ik.ts';

const near = (a, b, eps = 1e-4) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < eps), `${a} vs ${b}`);

test('a pulled trigger closes the index; a squeezed grip closes the other three', () => {
	const rest = controllerCurls({});
	const fist = controllerCurls({ trigger: { value: 1 }, squeeze: { value: 1 }, thumb: [{ pressed: true, value: 1 }] });
	assert.ok(fist.every((c) => c > 0.5 && c <= 1));
	assert.equal(fist[1], 1);
	assert.ok(rest[1] < 0.4 && rest[2] < 0.4, "loosely wrapped when idle");
	assert.ok(rest[0] > 0.25 && rest[0] < 0.5, "a thumb resting over the controller is bent, not sticking out");
});

test('resting a finger on a button (touched, not pressed) leans into it', () => {
	const idle = controllerCurls({ trigger: { value: 0 }, thumb: [{ value: 0 }] });
	const touching = controllerCurls({ trigger: { value: 0, touched: true }, thumb: [{ value: 0, touched: true }] });
	assert.ok(touching[1] > idle[1], 'index on the trigger');
	assert.ok(touching[0] > idle[0], 'thumb on a button');
	const half = controllerCurls({ trigger: { value: 0.5 } });
	assert.ok(half[1] > touching[1] && half[1] < 1, 'half pull is between touch and full');
});

test('a straight finger has no curl and a folded one has a lot', () => {
	const straight = [[0, 0, 0], [0, 0, 0.04], [0, 0, 0.07], [0, 0, 0.09], [0, 0, 0.11]];
	assert.equal(jointChainCurl(straight, FULL_BEND.finger), 0);
	// Each joint turns 90 degrees the same way: base, middle and tip fold into a curl.
	const folded = [[0, 0, 0], [0, 0, 0.04], [0, -0.03, 0.04], [-0.0, -0.03, 0.01], [0, 0, 0.01]];
	assert.ok(jointChainCurl(folded, FULL_BEND.finger) > 0.8);
});

test('hand frame: a palm-down hand with fingers forward has no rotation, left or right', () => {
	near(handFrameFromKnuckles([0, 0, 0], [0, 0, 0.09], [-0.03, 0, 0.09], [0.03, 0, 0.08], 'right'), [0, 0, 0, 1]);
	near(handFrameFromKnuckles([0, 0, 0], [0, 0, 0.09], [0.03, 0, 0.09], [-0.03, 0, 0.08], 'left'), [0, 0, 0, 1]);
});

test('hand frame follows the hand: fingers pointing right, back of the hand up, is a quarter turn', () => {
	const q = handFrameFromKnuckles([0, 0, 0], [0.09, 0, 0], [0.09, 0, 0.03], [0.08, 0, -0.03], 'right');
	near(rotateVector(q, [0, 0, 1]), [1, 0, 0]);
	near(rotateVector(q, [0, 1, 0]), [0, 1, 0]);
});

test('a hand turned palm up flips the back of the hand downward', () => {
	// Right hand rolled over: index now on the +X side.
	const q = handFrameFromKnuckles([0, 0, 0], [0, 0, 0.09], [0.03, 0, 0.09], [-0.03, 0, 0.08], 'right');
	near(rotateVector(q, [0, 1, 0]), [0, -1, 0]);
});

test('quatFromBasis reproduces the axes it was given', () => {
	const x = [0, 0, -1], y = [0, 1, 0], z = [1, 0, 0];
	const q = quatFromBasis(x, y, z);
	near(rotateVector(q, [1, 0, 0]), x);
	near(rotateVector(q, [0, 0, 1]), z);
});

test('the grip-to-hand roll is a quarter turn, opposite for the two hands', () => {
	const l = gripToHandRoll('left'), r = gripToHandRoll('right');
	near(rotateVector(l, [1, 0, 0]), [0, 1, 0]);
	near(rotateVector(r, [1, 0, 0]), [0, -1, 0]);
});

test('curls from the network are clamped and malformed ones are ignored', () => {
	assert.deepEqual(parseCurls([0, 2, -1, 0.5, 'x']), [0, 1, 0, 0.5, 0]);
	assert.equal(parseCurls([0, 1]), undefined);
	assert.equal(parseCurls('nope'), undefined);
});

test('easing moves towards the target without overshooting', () => {
	const next = easeCurls([0, 0, 0, 0, 0], [1, 1, 1, 1, 1], 0.05);
	assert.ok(next.every((v) => v > 0 && v < 1));
});

import { jointBends, parseBends, easeValues, BEND_COUNT } from '../src/lib/xr/avatar/fingers.ts';

test('joint bends give one angle per inner joint, each matching the turn at that joint', () => {
	const straight = jointBends([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3]]);
	assert.equal(straight.length, 2);
	assert.ok(straight.every((a) => a < 1e-6));
	const bends = jointBends([[0, 0, 0], [0, 0, 1], [0, -1, 1], [0, -1, 0]]);
	assert.ok(bends.every((a) => Math.abs(a - Math.PI / 2) < 1e-6));
});

test('a measured curl and the avatar’s full curl agree, so a fist is not exaggerated', async () => {
	const { FULL_BEND, JOINT_BEND } = await import('../src/lib/xr/avatar/fingers.ts');
	for (const finger of ['index', 'middle', 'ring']) {
		const sum = JOINT_BEND[finger].reduce((a, b) => a + b, 0);
		assert.ok(Math.abs(sum - FULL_BEND.finger) < 0.3, `${finger} ${sum}`);
	}
});

test('joint angles from the network are limited to a human range, and wrong-sized lists are ignored', () => {
	const raw = Array.from({ length: BEND_COUNT }, (_, i) => (i === 0 ? 9 : i === 1 ? -9 : 0.5));
	const parsed = parseBends(raw);
	assert.equal(parsed[0], 2.2);
	assert.equal(parsed[1], -0.4);
	assert.equal(parseBends([1, 2, 3]), undefined);
});

test('easeValues moves each value towards its target', () => {
	const next = easeValues([0, 1], [1, 0], 0.05);
	assert.ok(next[0] > 0 && next[0] < 1 && next[1] < 1 && next[1] > 0);
});

import { parseThumbDirections, conjugate, fistPitch, WRIST_BEHIND_GRIP } from '../src/lib/xr/avatar/fingers.ts';

test('thumb directions from the network become three unit vectors, or nothing if they are unusable', () => {
	const dirs = parseThumbDirections([0, 2, 0, 1, 0, 0, 0, 0, -3]);
	assert.deepEqual(dirs, [[0, 1, 0], [1, 0, 0], [0, 0, -1]]);
	assert.equal(parseThumbDirections([0, 0, 0, 1, 0, 0, 1, 0, 0]), undefined, 'a zero-length segment');
	assert.equal(parseThumbDirections([1, 2, 3]), undefined);
});

test('a direction taken into the hand frame and back gives the original', () => {
	const q = handFrameFromKnuckles([0, 0, 0], [0.09, 0.02, 0.01], [0.09, 0.02, 0.04], [0.08, 0.01, -0.03], 'right');
	const d = [0.3, 0.5, -0.8];
	const back = rotateVector(q, rotateVector(conjugate(q), d));
	near(back, d);
});

test('the controller fist pitch turns the hand frame so its thumb-up axis lies along the grip Z axis', () => {
	// hand frame thumb-up (+Y) -> grip frame: (almost) +Z; fingers forward (+Z) -> (almost) -Y.
	const up = rotateVector(fistPitch(), [0, 1, 0]);
	const forward = rotateVector(fistPitch(), [0, 0, 1]);
	assert.ok(up[2] > 0.99, `thumb-up ${up}`);
	assert.ok(forward[1] < -0.99, `forward ${forward}`);
	assert.ok(WRIST_BEHIND_GRIP > 0.05 && WRIST_BEHIND_GRIP < 0.12);
});
