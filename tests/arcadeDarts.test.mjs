import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { DARTS, buildDarts, dartId } from '../src/lib/xr/templates/arcadeDarts.ts';
import { aim, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(-7, 14.8, 0);
const tree = buildDarts(frame);
const machine = () => runMachine({ tree, frame, panelId: 'dt-ui' });
const SPOT = [0, 1.4, -2.3];
const GRAVITY = DARTS.gravity;

/** Throws dart `index` from the throw line so that it reaches the board at (x, y) from the middle of it. */
async function throwAt(world, index, holder, x, y, time = 0.45) {
	const target = [DARTS.center[0] + x, DARTS.center[1] + y, DARTS.boardZ - DARTS.tip];
	await world.throwFrom(dartId(index), holder, SPOT, aim(SPOT, target, time, GRAVITY));
	await world.tick(time + 0.2);
}

test('the darts are grabbable roots with a script that remembers their holder, and the board is on the wall', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length, 'ids are unique');
	for (let index = 0; index < DARTS.count; index++) {
		const dart = tree.find((slot) => slot.id === dartId(index));
		assert.equal(dart.parentId, null, 'a dart is a root slot, so it can fly');
		assert.ok(dart.components.some((c) => c.type === 'grabbable' && c.autoGrip === true));
		assert.ok(dart.components.some((c) => c.type === 'scriptState') && dart.components.some((c) => c.type === 'codeBlock'));
		assert.ok(tree.some((slot) => slot.parentId === dart.id && slot.components.some((c) => c.type === 'collider')), 'and can be picked up');
	}
	assert.ok(tree.find((slot) => slot.id === 'dt-board').components.some((c) => c.type === 'scoreboard'));
});

test('in practice a dart in the bullseye is called out and returns to the table', async () => {
	const world = machine();
	await world.throwFrom(dartId(0), 'me', SPOT, aim(SPOT, [DARTS.center[0], DARTS.center[1], DARTS.boardZ - DARTS.tip], 0.45, GRAVITY));
	await world.tick(0.6);
	assert.match(world.text('dt-msg'), /Practice throw: Bullseye! 50/);
	assert.ok(world.sounds().length > 0 && world.bursts().length > 0, 'a ding and sparks');
	assert.ok(world.local(dartId(0))[2] < 0.1 && world.local(dartId(0))[2] > -0.2, 'it sticks in the board');
	await world.tick(2.3);
	assert.deepEqual(world.local(dartId(0)).map((v) => Math.round(v * 100) / 100), DARTS.homes[0], 'and goes back to the table');
});

test('rings are worth what they say: triple 20 on top, double at the edge, the outer bull', async () => {
	const world = machine();
	const r = DARTS.radius;
	await throwAt(world, 0, 'me', 0, r * 0.62);
	assert.match(world.text('dt-msg'), /Triple 20: 60/);
	await throwAt(world, 1, 'me', 0, r * 0.95);
	assert.match(world.text('dt-msg'), /Double 20: 40/);
	await throwAt(world, 2, 'me', 0, r * 0.75);
	assert.match(world.text('dt-msg'), /: 20$/);
	await throwAt(world, 3, 'me', 0, r * 0.07);
	assert.match(world.text('dt-msg'), /Outer bull: 25/);
	await throwAt(world, 4, 'me', r * 0.62, 0);
	assert.match(world.text('dt-msg'), /Triple 6: 18/, '6 is on the right of the board');
	await throwAt(world, 5, 'me', -r * 0.62, 0);
	assert.match(world.text('dt-msg'), /Triple 11: 33/, '11 is on the left');
});

test('a dart that misses the board scores nothing and falls', async () => {
	const world = machine();
	await throwAt(world, 0, 'me', 0.9, 0.9);
	assert.match(world.text('dt-msg'), /Missed everything|Off the board/);
	await world.tick(3);
	assert.deepEqual(world.local(dartId(0)).map((v) => Math.round(v * 100) / 100), DARTS.homes[0]);
});

test('1 player: twelve darts, three a turn, and the total goes to the leaderboard', async () => {
	const world = machine();
	world.press('dt-b1');
	assert.match(world.text('dt-msg'), /3 darts left, round 1 of 4/);
	await world.tick(0.1);
	for (let i = 0; i < DARTS.perVisit * DARTS.rounds; i++) {
		await throwAt(world, i % DARTS.count, 'me', 0, DARTS.radius * 0.62);
		await world.tick(2.5);
	}
	assert.match(world.text('dt-msg'), /Game over! Final score: 720/);
	assert.equal(world.submitted.length, 1);
	assert.deepEqual([world.submitted[0].name, world.submitted[0].score, world.submitted[0].who.id], ['arcade-darts', 720, 'me']);
	assert.equal(world.rows('dt-board')[0].cells[0], '720');
	await world.tick(10);
	assert.match(world.text('dt-msg'), /Press 1 PLAYER|Grab a dart/, 'back to the start');
	assert.equal(world.rows('dt-board').length, 0);
});

test('versus: players join, throw in turns, and the one with most points wins', async () => {
	const world = machine();
	world.press('dt-bvs');
	assert.match(world.text('dt-msg'), /Versus: Me/);
	world.press('dt-bstart');
	assert.match(world.text('dt-msg'), /at least 2 players/, 'cannot start alone');
	world.press('dt-bjoin', 'ana');
	assert.match(world.text('dt-msg'), /Me, Ana/);
	world.press('dt-bjoin', 'ana');
	assert.match(world.text('dt-msg'), /already in/);
	world.press('dt-bstart');
	assert.match(world.text('dt-msg'), /Me: 3 darts left/);
	// Ana throws out of turn: it does not count.
	await throwAt(world, 0, 'ana', 0, DARTS.radius * 0.62);
	assert.match(world.text('dt-msg'), /Wait for your turn/);
	assert.equal(world.rows('dt-board')[0].cells[0], '0');
	// Me throws three triples, the turn passes to Ana, who throws three singles.
	for (let i = 0; i < 3; i++) await throwAt(world, i, 'me', 0, DARTS.radius * 0.62);
	assert.equal(world.rows('dt-board')[0].cells[0], '180');
	await world.tick(2.6);
	assert.match(world.text('dt-msg'), /Ana: 3 darts left, round 1 of 4/);
	assert.equal(world.rows('dt-board')[1].highlight, true);
	for (let i = 0; i < 3; i++) await throwAt(world, i, 'ana', 0, DARTS.radius * 0.75);
	await world.tick(2.6);
	assert.match(world.text('dt-msg'), /Me: 3 darts left, round 2 of 4/);
	assert.equal(world.rows('dt-board')[1].cells[0], '60');
	// The rest of the game: Me always wins.
	for (let turn = 2; turn < 8; turn++) {
		const holder = turn % 2 === 0 ? 'me' : 'ana';
		for (let i = 0; i < 3; i++) await throwAt(world, i, holder, 0, holder === 'me' ? DARTS.radius * 0.62 : DARTS.radius * 0.75);
		await world.tick(2.6);
	}
	assert.match(world.text('dt-msg'), /^Me wins!/);
	assert.deepEqual(world.submitted.map((entry) => [entry.who.id, entry.score]).sort(), [['ana', 240], ['me', 720]]);
	assert.equal(world.rows('dt-board').find((row) => row.name === 'Me').isLeader, true);
});

test('a player who leaves a versus game does not hold it up', async () => {
	const world = machine();
	world.press('dt-bvs');
	world.press('dt-bjoin', 'ana');
	world.press('dt-bjoin', 'bo');
	world.press('dt-bstart');
	world.press('dt-bleave', 'ana');
	assert.deepEqual(world.rows('dt-board').map((row) => row.name), ['Me', 'Bo']);
	world.press('dt-bleave');
	assert.match(world.text('dt-msg'), /Bo wins: the others left/);
});

test('a versus game that nobody joins gives up after the countdown', async () => {
	const world = machine();
	world.press('dt-bvs');
	await world.tick(21);
	assert.match(world.text('dt-msg'), /Nobody joined/);
	world.press('dt-b1');
	assert.match(world.text('dt-msg'), /darts left/);
	world.press('dt-bvs');
	assert.match(world.text('dt-msg'), /A game is on|darts left/, 'a game in progress is not interrupted');
});

test('the same throw scores the same when the machine is turned to face another way', async () => {
	const turned = makeFrame(11.2, 7, -Math.PI / 2);
	const turnedTree = buildDarts(turned);
	const world = runMachine({ tree: turnedTree, frame: turned, panelId: 'dt-ui' });
	const target = [DARTS.center[0], DARTS.center[1] + DARTS.radius * 0.62, DARTS.boardZ - DARTS.tip];
	await world.throwFrom(dartId(0), 'me', SPOT, aim(SPOT, target, 0.45, GRAVITY));
	await world.tick(0.6);
	assert.match(world.text('dt-msg'), /Triple 20: 60/);
});
