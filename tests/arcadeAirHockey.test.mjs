import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { HOCKEY, HOCKEY_IDS, buildAirHockey } from '../src/lib/xr/templates/arcadeAirHockey.ts';
import { DT, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(0, 7, Math.PI / 2);
const tree = buildAirHockey(frame);
const machine = () => runMachine({ tree, frame, panelId: 'ah-ui' });
const [PAD0, PAD1] = HOCKEY_IDS.pads;

/** A mallet swept along z at `speed` m/s, at x, from fromZ to toZ, then let go. */
async function sweep(world, pad, holder, x, fromZ, toZ, speed = 3) {
	const dir = Math.sign(toZ - fromZ);
	const path = [];
	for (let z = fromZ; dir > 0 ? z <= toZ : z >= toZ; z += (dir * speed) / 60) path.push([x, HOCKEY.padY, z]);
	await world.carry(pad, holder, path);
	await world.release(pad);
}
const versus = async () => {
	const world = machine();
	world.press('ah-bvs');
	world.press('ah-bjoin', 'ana');
	world.press('ah-bstart');
	// The second player keeps their mallet out of the way of the shots.
	world.placeLocal(PAD1, [0.42, HOCKEY.padY, HOCKEY.length - 0.4]);
	return world;
};
const puckAt = (world) => world.local(HOCKEY_IDS.puck);

test('the table has two grabbable mallets, an ungrabbable puck, and a score board for each end', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	for (const id of HOCKEY_IDS.pads) assert.ok(tree.find((slot) => slot.id === id).components.some((c) => c.type === 'grabbable'));
	assert.ok(!tree.find((slot) => slot.id === HOCKEY_IDS.puck).components.some((c) => c.type === 'grabbable'));
	assert.deepEqual(tree.find((slot) => slot.id === HOCKEY_IDS.boardFar).rotation, [0, 1, 0, 0], 'turned to face the far end');
	const goalGap = tree.filter((slot) => /^ah-end-/.test(slot.id));
	assert.equal(goalGap.length, 4, 'each end is a wall with a mouth in the middle');
});

test('a hit sends the puck away, it bounces off the sides and a goal scores for whoever shot it', async () => {
	const world = await versus();
	assert.match(world.text('ah-msg'), /Me 0 {3}- {3}Ana 0/);
	await world.tick(0.1);
	assert.ok(Math.abs(puckAt(world)[2] - HOCKEY.length * 0.3) < 0.01, 'the puck is served on the first player\'s side');
	await sweep(world, PAD0, 'me', 0, 0.2, 0.75);
	await world.tick(0.2);
	assert.ok(puckAt(world)[2] > 0.8, 'the puck was hit away');
	await world.tick(1.5);
	assert.match(world.text('ah-msg'), /Me scores!/);
	assert.deepEqual(world.rows('ah-board').map((row) => row.cells[0]), ['1', '0']);
	assert.deepEqual(world.rows('ah-board-b').map((row) => row.cells[0]), ['1', '0'], 'the far board shows the same');
	assert.ok(world.sounds().length > 0 && world.bursts().length > 0);
	await world.tick(2);
	assert.ok(Math.abs(puckAt(world)[2] - HOCKEY.length * 0.7) < 0.01, 'the next puck is served to the player who conceded');
});

test('a shot at an angle bounces off the side and the puck never leaves the table', async () => {
	const world = await versus();
	await world.tick(0.1);
	let maxX = 0;
	for (let shot = 0; shot < 12; shot++) {
		const z = puckAt(world)[2];
		const x = (shot % 2 ? -1 : 1) * 0.04;
		await sweep(world, shot % 2 ? PAD1 : PAD0, shot % 2 ? 'ana' : 'me', puckAt(world)[0] + x, shot % 2 ? z + 0.4 : z - 0.4, shot % 2 ? z - 0.2 : z + 0.2, 3.5);
		for (let i = 0; i < 40; i++) {
			await world.tick(DT, 1);
			const p = puckAt(world);
			maxX = Math.max(maxX, Math.abs(p[0]));
			assert.ok(Math.abs(p[0]) <= HOCKEY.halfWidth + 1e-6, `x ${p[0]}`);
			assert.ok(p[2] > -0.25 && p[2] < HOCKEY.length + 0.25, `z ${p[2]}`);
		}
	}
	assert.ok(maxX > 0.3, 'the puck did travel across the table');
});

test('the puck slows down on its own and never goes faster than the limit', async () => {
	const world = await versus();
	await world.tick(0.1);
	await sweep(world, PAD0, 'me', 0.3, 0.2, 0.75, 9);
	await world.tick(DT, 2);
	const a = puckAt(world), b = (await world.tick(DT, 1), puckAt(world));
	assert.ok(Math.hypot(b[0] - a[0], b[2] - a[2]) / DT <= HOCKEY.maxSpeed + 0.3, 'capped');
});

test('first to seven wins, and the margin goes to the leaderboard', async () => {
	const world = await versus();
	await world.tick(0.1);
	for (let goal = 0; goal < HOCKEY.target; goal++) {
		await world.tick(1.8);
		const z = puckAt(world)[2];
		await sweep(world, PAD0, 'me', 0, z - 0.4, z + 0.1);
		await world.tick(1.6);
	}
	assert.match(world.text('ah-msg'), /^Me wins!/);
	assert.deepEqual(world.submitted.map((entry) => [entry.name, entry.who.id, entry.score]).sort(), [['arcade-airhockey', 'ana', -7], ['arcade-airhockey', 'me', 7]]);
});

test('1 player: a robot plays the far mallet, stays in its half, goes for the puck and is not saved on the leaderboard', async () => {
	const world = machine();
	world.press('ah-b1');
	assert.match(world.text('ah-msg'), /Me 0 {3}- {3}Robot 0/);
	let maxStep = 0, previous = world.local(PAD1), closest = 9;
	const watch = async (seconds) => {
		previous = world.local(PAD1);
		for (let i = 0; i < seconds * 60; i++) {
			await world.tick(DT, 1);
			const now = world.local(PAD1);
			maxStep = Math.max(maxStep, Math.hypot(now[0] - previous[0], now[2] - previous[2]) / DT);
			previous = now;
			assert.ok(now[2] >= HOCKEY.length / 2 && now[2] <= HOCKEY.length && Math.abs(now[0]) <= HOCKEY.halfWidth, `robot at ${now}`);
			const p = puckAt(world);
			if (p[2] > HOCKEY.length / 2) closest = Math.min(closest, Math.hypot(p[0] - now[0], p[2] - now[2]));
		}
	};
	await watch(1);
	// A gentle shot into the robot's half, off to one side.
	await world.tick(0.1);
	const p = puckAt(world);
	await sweep(world, PAD0, 'me', p[0] + 0.045, p[2] - 0.3, p[2] + 0.12, 1.4);
	await watch(6);
	assert.ok(maxStep <= HOCKEY.botSpeed + 0.05, `the robot moves at most ${HOCKEY.botSpeed} m/s: ${maxStep}`);
	assert.ok(closest <= HOCKEY.padRadius + HOCKEY.puckRadius + 0.03, `the robot went for the puck: ${closest}`);
	world.press('ah-bleave');
	assert.equal(world.rows('ah-board').length, 0, 'leaving a game against the robot ends it');
	assert.equal(world.submitted.length, 0, 'nothing is saved for an abandoned game');
});

test('a mallet that was let go outside the table comes back after a while', async () => {
	const world = machine();
	await world.carry(PAD0, 'me', [[2, HOCKEY.padY, 0.5], [2, HOCKEY.padY, 0.5]]);
	await world.release(PAD0);
	await world.tick(7);
	assert.deepEqual(world.local(PAD0).map((v) => Math.round(v * 100) / 100), [0, Math.round(HOCKEY.padY * 100) / 100, 0.4]);
});
