import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { BASKETBALL, ballId, buildBasketball } from '../src/lib/xr/templates/arcadeBasketball.ts';
import { DT, aim, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(7, 14.8, 0);
const tree = buildBasketball(frame);
const machine = () => runMachine({ tree, frame, panelId: 'bb-ui' });
const G = BASKETBALL.gravity;
const [rx, ry, rz] = BASKETBALL.rim;

/** Shoots ball `index` from (0, 1.3, z) so it reaches the rim height, `dx` to the side of the centre of the rim, on its way down. */
async function shoot(world, index, holder, z = BASKETBALL.freeThrowZ, dx = 0, time = 1.0) {
	const from = [0, 1.3, z];
	await world.throwFrom(ballId(index), holder, from, aim(from, [rx + dx, ry, rz], time, G));
	await world.tick(time + 0.6);
}

test('there are three grabbable balls on a rack, a hoop with a rim of the right height and a board each side', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	for (let index = 0; index < BASKETBALL.count; index++) {
		const ball = tree.find((slot) => slot.id === ballId(index));
		assert.equal(ball.parentId, null);
		assert.ok(ball.components.some((c) => c.type === 'grabbable' && c.autoGrip === true) && ball.components.some((c) => c.type === 'collider'));
	}
	assert.equal(tree.filter((slot) => /^bb-rim-/.test(slot.id)).length, 12);
	assert.ok(BASKETBALL.rimRadius > BASKETBALL.ballRadius * 1.8, 'the ball fits through the rim');
});

test('a ball through the hoop is a basket: two points, three from behind the far line', async () => {
	const world = machine();
	await shoot(world, 0, 'me');
	assert.match(world.text('bb-msg'), /Nice shot! 2 points \(practice\)/, 'before a game there is only practice');
	world.press('bb-b1');
	await shoot(world, 1, 'me');
	assert.match(world.text('bb-msg'), /Me scores 2!/);
	await shoot(world, 2, 'me', BASKETBALL.threeZ - 0.3, 0, 1.2);
	assert.match(world.text('bb-msg'), /Me scores 3!/);
	assert.equal(world.rows('bb-board')[0].cells[0], '5');
	assert.ok(world.sounds().length > 0 && world.bursts().length > 0);
});

test('a ball that misses the hoop scores nothing, and every ball goes home to the rack', async () => {
	const world = machine();
	world.press('bb-b1');
	await shoot(world, 0, 'me', BASKETBALL.freeThrowZ, 0.9);
	assert.equal(world.rows('bb-board')[0].cells[0], '0');
	await world.tick(6);
	assert.deepEqual(world.local(ballId(0)).map((v) => Math.round(v * 100) / 100), BASKETBALL.homes[0]);
});

test('the backboard sends the ball back and the ball never goes through it', async () => {
	const world = machine();
	const from = [0.3, 1.3, -1.4];
	await world.throwFrom(ballId(0), 'me', from, [0, 5.5, 6.5]);
	let maxZ = -9;
	for (let i = 0; i < 120; i++) { await world.tick(DT, 1); maxZ = Math.max(maxZ, world.local(ballId(0))[2]); }
	assert.ok(maxZ <= BASKETBALL.boardZ - BASKETBALL.ballRadius + 0.01, `the ball reached z ${maxZ}`);
	assert.ok(maxZ > 1, 'it did get to the board');
});

test('the rim sends a ball that hits the iron away instead of letting it through', async () => {
	const world = machine();
	world.press('bb-b1');
	// The centre of this ball passes right over the rim iron.
	await shoot(world, 0, 'me', BASKETBALL.freeThrowZ, 0.26);
	assert.equal(world.rows('bb-board')[0].cells[0], '0');
});

test('the game lasts a minute and the total goes to the leaderboard', async () => {
	const world = machine();
	world.press('bb-b1');
	assert.match(world.text('bb-msg'), /Time left: 60 s/);
	await shoot(world, 0, 'me');
	await world.tick(20);
	assert.match(world.text('bb-msg'), /Time left: (3\d|40) s/);
	await world.tick(41);
	assert.match(world.text('bb-msg'), /Game over! Final score: 2/);
	assert.deepEqual(world.submitted.map((entry) => [entry.name, entry.score]), [['arcade-basketball', 2]]);
	await shoot(world, 1, 'me');
	assert.equal(world.rows('bb-board')[0].cells[0], '2', 'after the whistle, baskets do not count');
});

test('versus: everybody plays at once and each basket is for whoever threw it', async () => {
	const world = machine();
	world.press('bb-bvs');
	world.press('bb-bjoin', 'ana');
	world.press('bb-bstart');
	await shoot(world, 0, 'me');
	await shoot(world, 1, 'ana', BASKETBALL.threeZ - 0.3, 0, 1.2);
	await shoot(world, 2, 'zed');
	assert.deepEqual(world.rows('bb-board').map((row) => [row.name, row.cells[0]]), [['Me', '2'], ['Ana', '3']], 'Zed is not in the game');
	await world.tick(61);
	assert.match(world.text('bb-msg'), /^Ana wins!/);
	assert.equal(world.rows('bb-board').find((row) => row.name === 'Ana').isLeader, true);
	assert.deepEqual(world.submitted.map((entry) => [entry.who.id, entry.score]).sort(), [['ana', 3], ['me', 2]]);
});

test('a draw is a draw', async () => {
	const world = machine();
	world.press('bb-bvs');
	world.press('bb-bjoin', 'ana');
	world.press('bb-bstart');
	await shoot(world, 0, 'me');
	await shoot(world, 1, 'ana');
	await world.tick(61);
	assert.match(world.text('bb-msg'), /A draw between Me & Ana!/);
});
