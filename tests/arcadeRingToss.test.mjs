import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { RING_TOSS, buildRingToss, ringId } from '../src/lib/xr/templates/arcadeRingToss.ts';
import { aim, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(0, 15, 0);
const tree = buildRingToss(frame);
const machine = () => runMachine({ tree, frame, panelId: 'rt-ui' });
const SPOT = [0, 1.3, RING_TOSS.line];
const PEG_TOP = RING_TOSS.platformTop + RING_TOSS.pegHeight;

/** Lobs ring `index` so that it comes down over (x, z) at the height of the peg tops, `dx` and `dz` off. */
async function lob(world, index, holder, x, z, dx = 0, dz = 0, time = 1.0) {
	await world.throwFrom(ringId(index), holder, SPOT, aim(SPOT, [x + dx, PEG_TOP, z + dz], time, RING_TOSS.gravity));
	await world.tick(time + 0.4);
}
const peg = (points) => RING_TOSS.pegs.find((p) => p.points === points);

test('six grabbable rings, eight pegs on a platform, and a label on the platform for each peg', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	for (let index = 0; index < RING_TOSS.count; index++) {
		const ring = tree.find((slot) => slot.id === ringId(index));
		assert.ok(ring.components.some((c) => c.type === 'grabbable' && c.autoGrip === true));
		assert.ok(tree.some((slot) => slot.parentId === ring.id && slot.components.some((c) => c.type === 'collider')));
	}
	assert.equal(tree.filter((slot) => /^rt-peg-\d$/.test(slot.id)).length, RING_TOSS.pegs.length);
	assert.equal(tree.filter((slot) => /^rt-peg-\d-label$/.test(slot.id)).length, RING_TOSS.pegs.length);
	for (const p of RING_TOSS.pegs) assert.ok(Math.abs(p.x) <= RING_TOSS.platform.x && p.z > RING_TOSS.platform.zMin && p.z < RING_TOSS.platform.zMax, 'every peg is on the platform');
});

test('a ring that comes down over a peg is worth what that peg says, and stays on it until it goes home', async () => {
	const world = machine();
	const back = peg(50);
	await lob(world, 0, 'me', back.x, back.z);
	assert.match(world.text('rt-msg'), /Practice throw: Ringer! 50/);
	const at = world.local(ringId(0));
	assert.ok(Math.abs(at[0] - back.x) < 0.01 && Math.abs(at[2] - back.z) < 0.01 && at[1] < PEG_TOP, 'round the peg');
	assert.ok(world.sounds().length > 0 && world.bursts().length > 0);
	await world.tick(2.6);
	assert.deepEqual(world.local(ringId(0)).map((v) => Math.round(v * 100) / 100), RING_TOSS.homes[0]);
});

test('a ring on the platform but off a peg, and one that falls short, are worth nothing', async () => {
	const world = machine();
	const p = peg(20);
	await lob(world, 0, 'me', p.x, p.z, 0.16, 0);
	assert.match(world.text('rt-msg'), /No luck: 0/);
	await lob(world, 1, 'me', 0, -0.5, 0, 0);
	assert.match(world.text('rt-msg'), /No luck: 0/);
	assert.ok(world.local(ringId(1))[1] < 0.1, 'it fell to the floor');
});

test('1 player: six rings, and the total goes to the leaderboard', async () => {
	const world = machine();
	world.press('rt-b1');
	assert.match(world.text('rt-msg'), /3 rings left, round 1 of 2/);
	const order = [50, 20, 20, 10, 10, 50];
	for (let i = 0; i < order.length; i++) {
		const p = peg(order[i]);
		await lob(world, i, 'me', p.x, p.z);
		await world.tick(2.5);
	}
	assert.match(world.text('rt-msg'), /Game over! Final score: 160/);
	assert.deepEqual(world.submitted.map((entry) => [entry.name, entry.score]), [['arcade-ringtoss', 160]]);
});

test('versus: players alternate every three rings and the best total wins', async () => {
	const world = machine();
	world.press('rt-bvs');
	world.press('rt-bjoin', 'ana');
	world.press('rt-bstart');
	for (let turn = 0; turn < 4; turn++) {
		const holder = turn % 2 === 0 ? 'me' : 'ana';
		assert.match(world.text('rt-msg'), turn % 2 === 0 ? /Me: 3 rings left/ : /Ana: 3 rings left/);
		for (let i = 0; i < 3; i++) {
			const p = peg(holder === 'me' ? 20 : 10);
			await lob(world, i, holder, p.x, p.z);
			await world.tick(0.3);
		}
		await world.tick(2.8);
	}
	assert.match(world.text('rt-msg'), /^Me wins!/);
	assert.deepEqual(world.rows('rt-board').map((row) => row.cells[0]), ['120', '60']);
});
