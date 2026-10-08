import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { WHACK, buildWhack, malletHeadId, malletId, moleId } from '../src/lib/xr/templates/arcadeWhack.ts';
import { DT, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(-11, 7, -Math.PI / 2);
const tree = buildWhack(frame);
const machine = () => runMachine({ tree, frame, panelId: 'wm-ui' });
const moleY = (world, index) => world.local(moleId(index))[1];
const upMoles = (world) => WHACK.holes.map((_, index) => index).filter((index) => moleY(world, index) > WHACK.top + 0.05);

/** Waits until a mole is out, and says which. */
async function waitForMole(world) {
	for (let i = 0; i < 60 * 5; i++) {
		await world.tick(DT, 1);
		const [first] = upMoles(world);
		if (first !== undefined && moleY(world, first) >= WHACK.top + 0.09) return first;
	}
	throw new Error('no mole came out');
}

/** A mallet held by `holder` brings its head down on the mole, fast, and is lifted away again. */
async function whack(world, malletIndex, holder, moleIndex, { held = true, speed = 2.7 } = {}) {
	const id = malletId(malletIndex);
	world.holderOf(id, holder);
	if (held) world.held.add(id);
	const [x, , z] = world.local(moleId(moleIndex));
	const stepDown = speed * DT;
	for (let height = WHACK.top + 0.3; height > WHACK.top + 0.02; height -= stepDown) {
		world.placeLocal(malletHeadId(malletIndex), [x, height, z]);
		await world.tick(DT, 1);
	}
	world.held.delete(id);
	await world.tick(DT, 1);
}

test('there are nine moles in nine holes, hidden under the table, and four grabbable mallets with a head', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	for (let index = 0; index < WHACK.holes.length; index++) {
		const mole = tree.find((slot) => slot.id === moleId(index));
		assert.equal(mole.parentId, null);
		assert.ok(!mole.components.some((c) => c.type === 'grabbable' || c.type === 'collider'), 'a mole cannot be picked up or walked into');
		const [x, , z] = [mole.position[0] - frame.o[0], 0, mole.position[2] - frame.o[2]];
		assert.ok(Math.abs(x * frame.r[0] + z * frame.r[2]) < 0.5, 'in a hole of the table');
		assert.ok(mole.position[1] + mole.scale[1] / 2 <= WHACK.top, 'hidden below the table top');
	}
	for (let index = 0; index < WHACK.malletCount; index++) {
		const mallet = tree.find((slot) => slot.id === malletId(index));
		assert.ok(mallet.components.some((c) => c.type === 'grabbable' && c.autoGrip === true));
		assert.equal(tree.find((slot) => slot.id === malletHeadId(index)).parentId, mallet.id);
	}
});

test('before a game the moles pop up now and then, and a hit is only practice', async () => {
	const world = machine();
	const index = await waitForMole(world);
	await whack(world, 0, 'me', index);
	assert.match(world.text('wm-msg'), /Whack! \(practice\)/);
	assert.ok(world.sounds().length > 0 && world.bursts().length > 0);
	await world.tick(1);
	assert.equal(moleY(world, index) < WHACK.top, true, 'and it goes back down');
});

test('1 player: a hit is a point, a mole can be hit once, a swing from a hand that is not holding the mallet does nothing', async () => {
	const world = machine();
	world.press('wm-b1');
	assert.match(world.text('wm-msg'), /Time left: 45 s/);
	const index = await waitForMole(world);
	await whack(world, 0, 'me', index, { held: false });
	assert.equal(world.rows('wm-board')[0].cells[0], '0');
	await whack(world, 0, 'me', index);
	assert.equal(world.rows('wm-board')[0].cells[0], '1');
	await whack(world, 1, 'me', index);
	assert.equal(world.rows('wm-board')[0].cells[0], '1', 'the same mole is not hit twice');
});

test('a slow tap does not whack, and neither does a swing beside the mole', async () => {
	const world = machine();
	world.press('wm-b1');
	const index = await waitForMole(world);
	await whack(world, 0, 'me', index, { speed: 0.4 });
	assert.equal(world.rows('wm-board')[0].cells[0], '0');
	const [x, , z] = world.local(moleId(index));
	world.held.add(malletId(0));
	for (let height = WHACK.top + 0.3; height > WHACK.top + 0.02; height -= 2.7 * DT) { world.placeLocal(malletHeadId(0), [x + 0.4, height, z]); await world.tick(DT, 1); }
	assert.equal(world.rows('wm-board')[0].cells[0], '0');
});

test('there are never more than three moles out for one player, and the game ends after 45 seconds with the score saved', async () => {
	const world = machine();
	world.press('wm-b1');
	let most = 0, seen = new Set();
	for (let i = 0; i < 60 * 44; i++) { await world.tick(DT, 1); const up = upMoles(world); most = Math.max(most, up.length); up.forEach((index) => seen.add(index)); }
	assert.ok(most >= 2 && most <= 3, `${most} moles out at most`);
	assert.ok(seen.size >= 6, `${seen.size} different holes used`);
	await world.tick(2);
	assert.match(world.text('wm-msg'), /Game over! Final score: 0/);
	assert.deepEqual(world.submitted.map((entry) => [entry.name, entry.score]), [['arcade-whack', 0]]);
	await world.tick(1.5);
	assert.equal(upMoles(world).length, 0, 'no moles out after the end');
});

test('versus: each hit is for the player who swung, and a player who is not in the game scores nothing', async () => {
	const world = machine();
	world.press('wm-bvs');
	world.press('wm-bjoin', 'ana');
	world.press('wm-bstart');
	const hits = { me: 0, ana: 0 };
	const scores = () => world.rows('wm-board').map((row) => row.cells[0]).join();
	for (const [mallet, holder] of [[0, 'me'], [1, 'ana'], [1, 'ana'], [2, 'zed']]) {
		const before = scores();
		// A mole that is already on its way down can be missed: try again with the next one.
		for (let attempt = 0; attempt < 6 && scores() === before; attempt++) {
			await whack(world, mallet, holder, await waitForMole(world));
			await world.tick(1.2);
			if (holder === 'zed') break;
		}
		if (holder in hits) hits[holder] += 1;
		if (holder === 'zed') assert.equal(scores(), before, 'zed is not in the game');
	}
	assert.deepEqual(world.rows('wm-board').map((row) => [row.name, Number(row.cells[0])]), [['Me', hits.me], ['Ana', hits.ana]]);
	assert.equal(hits.ana, 2);
	await world.tick(45);
	assert.match(world.text('wm-msg'), /^Ana wins!/);
});

test('a mallet that was dropped away from the rack goes back to it', async () => {
	const world = machine();
	world.held.add(malletId(2));
	world.placeLocal(malletId(2), [0.5, 0.2, -1]);
	await world.tick(DT, 3);
	world.held.delete(malletId(2));
	await world.tick(7);
	assert.deepEqual(world.local(malletId(2)).map((v) => Math.round(v * 100) / 100), WHACK.malletHomes[2]);
});
