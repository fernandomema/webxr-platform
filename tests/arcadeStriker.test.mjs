import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../src/lib/xr/templates/arcadeKit.ts';
import { STRIKER, STRIKER_IDS, buildStriker } from '../src/lib/xr/templates/arcadeStriker.ts';
import { DT, runMachine } from './helpers/arcadeMachine.mjs';

const frame = makeFrame(11, 9, Math.PI / 2);
const tree = buildStriker(frame);
const machine = () => runMachine({ tree, frame, panelId: 'st-ui' });
const litSegments = (world) => STRIKER_IDS.segments.filter((id) => world.slots.get(id).components.find((c) => c.type === 'meshRenderer').color !== '#1f2937').length;

/** The head of the mallet comes down on the pad at `speed` m/s (from above, so it is up to speed when it arrives). */
async function blow(world, holder, speed, { x = 0, held = true } = {}) {
	world.holderOf(STRIKER_IDS.mallet, holder);
	if (held) world.held.add(STRIKER_IDS.mallet);
	for (let y = STRIKER.padTop + 0.9; y > STRIKER.padTop + 0.02; y -= speed * DT) { world.placeLocal(STRIKER_IDS.head, [x, y, STRIKER.padZ]); await world.tick(DT, 1); }
	world.held.delete(STRIKER_IDS.mallet);
	await world.tick(0.1);
}

test('a grabbable mallet with a head, a pad, ten lights and a bell', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	assert.ok(tree.find((slot) => slot.id === STRIKER_IDS.mallet).components.some((c) => c.type === 'grabbable' && c.autoGrip === true));
	assert.equal(tree.find((slot) => slot.id === STRIKER_IDS.head).parentId, STRIKER_IDS.mallet);
	assert.equal(STRIKER_IDS.segments.length, STRIKER.levels);
	assert.ok(tree.find((slot) => slot.id === STRIKER_IDS.bell));
});

test('a blow lights the tower as high as it was hard, then the lights go out', async () => {
	const world = machine();
	await blow(world, 'me', 5);
	assert.match(world.text('st-msg'), /Practice blow: Power (4\d|5\d)/);
	await world.tick(0.7);
	const level = litSegments(world);
	assert.ok(level >= 4 && level <= 6, `${level} lights for a medium blow`);
	assert.ok(world.sounds().length > 3, 'a thud and a tick for each light');
	await world.tick(3);
	assert.equal(litSegments(world), 0);
	await blow(world, 'me', 12);
	await world.tick(1);
	assert.equal(litSegments(world), 10);
	assert.match(world.text('st-msg'), /RING THE BELL! 100/);
	assert.ok(world.sounds().some((sound) => sound.components[0].frequency === 1568), 'and the bell rings');
});

test('a gentle tap, a blow beside the pad and a blow with a mallet nobody holds do nothing', async () => {
	const world = machine();
	await blow(world, 'me', 0.5);
	await blow(world, 'me', 6, { x: 0.6 });
	await blow(world, 'me', 6, { held: false });
	await world.tick(1);
	assert.equal(litSegments(world), 0);
	assert.match(world.text('st-msg'), /Grab the big mallet/);
});

test('one blow does not count twice, even if the head lingers on the pad', async () => {
	const world = machine();
	world.press('st-b1');
	await blow(world, 'me', 6);
	assert.equal(world.rows('st-board')[0].cells[0] !== '0', true);
	const first = world.rows('st-board')[0].cells[0];
	world.held.add(STRIKER_IDS.mallet);
	for (let i = 0; i < 20; i++) { world.placeLocal(STRIKER_IDS.head, [0, STRIKER.padTop + 0.05 - (i % 2) * 0.1, STRIKER.padZ]); await world.tick(DT, 1); }
	assert.equal(world.rows('st-board')[0].cells[0], first);
});

test('1 player: three blows, the best one counts and is saved', async () => {
	const world = machine();
	world.press('st-b1');
	assert.match(world.text('st-msg'), /Me: blow 1 of 3/);
	await blow(world, 'me', 4);
	await world.tick(2.5);
	assert.match(world.text('st-msg'), /blow 2 of 3/);
	await blow(world, 'me', 8);
	await world.tick(2.5);
	await blow(world, 'me', 6);
	await world.tick(2.5);
	assert.match(world.text('st-msg'), /Game over! Final score: [78]\d/);
	assert.equal(world.submitted.length, 1);
	assert.ok(world.submitted[0].score >= 70 && world.submitted[0].score <= 85, `best blow ${world.submitted[0].score}`);
});

test('versus: one blow each in turn, a blow out of turn is not counted, the hardest wins', async () => {
	const world = machine();
	world.press('st-bvs');
	world.press('st-bjoin', 'ana');
	world.press('st-bstart');
	await blow(world, 'ana', 9);
	assert.match(world.text('st-msg'), /Wait for your turn/);
	await world.tick(2);
	assert.deepEqual(world.rows('st-board').map((row) => row.cells[0]), ['0', '0']);
	const speeds = { me: [4, 5, 5], ana: [7, 4, 3] };
	for (let round = 0; round < 3; round++) {
		for (const holder of ['me', 'ana']) { await blow(world, holder, speeds[holder][round]); await world.tick(2.5); }
	}
	assert.match(world.text('st-msg'), /^Ana wins!/);
});
