import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../src/lib/content/templates/deadDropGen.ts';
import { GRID, POOLS, TUNING, WEAPONS } from '../src/lib/content/templates/deadDropData.ts';
import { ID } from '../src/lib/content/templates/deadDropKit.ts';
import { DT, runDeadDrop } from './helpers/deadDropGame.mjs';

const SEED = 1234;
const layout = generateLayout(SEED);
const cellOf = (x, z) => [Math.round((x - GRID.origin[0]) / GRID.cell) + 1, Math.round((z - GRID.origin[2]) / GRID.cell) + 1];
const centre = (cx, cz) => [GRID.origin[0] + (cx - 1) * GRID.cell, 0, GRID.origin[2] + (cz - 1) * GRID.cell];

/** A world with `names` in it, each holding a gun, and a raid started on `seed`. */
async function raid(names = ['host'], seed = SEED) {
	const game = runDeadDrop();
	for (const [i, name] of names.entries()) { game.addPlayer(name, name, [i * 0.5, 1.6, 0]); game.equip(name); }
	await game.startRaid(names, seed);
	return game;
}
/** Takes every enemy but the ones named out of the fight. */
function only(game, ...keep) {
	for (const e of game.enemies()) if (!keep.includes(e)) { e.dead = true; game.ctx.world.setWorldPose(e.id, { position: [0, -200, 0] }); }
}
/** Lets the grace period pass, with the player where they are. */
const afterGrace = (game) => game.tick(TUNING.grace + 0.5);

test('a raid does not start until somebody has a weapon equipped, and says why', async () => {
	const game = runDeadDrop();
	game.addPlayer('host', 'Host');
	game.press(ID.start);
	await game.tick(0.1);
	assert.match(game.message(), /weapon/i);
	assert.equal(game.game.R.on, false);
	assert.deepEqual(game.teleports, []);
	game.press(ID.join);
	assert.match(game.message(), /weapon/i, 'joining needs one too');
});

test('joining shows the squad and the kit it will take; starting sends everyone to the entry of a map that follows from the seed', async () => {
	const game = runDeadDrop();
	game.addPlayer('host', 'Host');
	game.equip('host');
	game.press(ID.join);
	assert.match(game.message(), /Squad: Host/);
	assert.match(game.message(), /Your kit: Submachine Gun, Pistol, 90 rounds, 2 medkits/);
	game.game.setSeed(SEED);
	game.press(ID.start);
	await game.tick(DT);
	const R = game.game.R;
	assert.equal(R.on, true);
	assert.equal(game.player('host').state, 'raid');
	assert.equal(game.teleports.length, 1);
	const [x, , z] = game.teleports[0].position;
	assert.deepEqual(cellOf(x, z), layout.entry, 'they arrive in the entry room');
	assert.equal(game.teleports[0].yaw, 0);
	assert.deepEqual(R.layout, layout);
});

test('what the layout decides is switched on: doorways where it has them, props in every room, two exits, loot and enemies on the floor', async () => {
	const game = await raid();
	const open = (kind, x, z) => game.enabled(`${ID.edge(kind, x, z)}-top`);
	let doors = 0;
	for (let z = 0; z < 3; z++) for (let x = 0; x < 2; x++) { assert.equal(open('e', x, z), layout.east[z][x]); assert.equal(game.enabled(ID.edge('e', x, z)), !layout.east[z][x]); doors += open('e', x, z); }
	for (let z = 0; z < 2; z++) for (let x = 0; x < 3; x++) { assert.equal(open('n', x, z), layout.north[z][x]); assert.equal(game.enabled(ID.edge('n', x, z)), !layout.north[z][x]); doors += open('n', x, z); }
	assert.ok(doors >= 9);
	let props = 0;
	for (let cz = 0; cz < 3; cz++) for (let cx = 0; cx < 3; cx++) for (let v = 0; v < 2; v++) for (let c = 0; c < 4; c++) if (game.enabled(ID.prop(cx, cz, v, c))) props++;
	assert.equal(props, 36, 'four props in each of nine rooms');
	const exits = [0, 1, 2].filter((i) => game.pos(ID.exit(i))[1] > -100);
	assert.equal(exits.length, 2, 'two exits are open');
	assert.equal(game.game.R.loot.length, layout.loot.length);
	for (const loot of game.game.R.loot) assert.ok(game.pos(ID.loot(loot.i))[1] > 0, 'loot lies on a prop');
	const kinds = (kind) => game.enemies().filter((e) => e.kind === kind).length;
	assert.equal(kinds('soldier') + kinds('heavy'), layout.soldiers.length, 'every post has a soldier (a heavy in the vault)');
	assert.equal(kinds('turret'), layout.turrets.length);
	assert.ok(kinds('dog') <= POOLS.dogs);
	assert.ok(game.flushes.length >= 1, 'guests are sent the new structure');
	assert.deepEqual(game.logs, []);
});

test('the kit comes out of the stash: weapons and the first armour go with the player, 90 rounds and two medkits go in the pack', async () => {
	const game = await raid();
	const p = game.player('host');
	assert.deepEqual(p.weapons, ['smg', 'pistol']);
	assert.deepEqual(p.mags, [WEAPONS.smg.mag, WEAPONS.pistol.mag]);
	assert.equal(p.pack.find((e) => e.id === 'ammo9').n, 90);
	assert.equal(p.pack.find((e) => e.id === 'medkit').n, 2);
	const stash = game.game.profileOf('host').stash;
	assert.equal(stash.find((e) => e.id === 'smg'), undefined, 'the submachine gun is out of the stash');
	assert.equal(stash.find((e) => e.id === 'ammo9').n, 60);
	assert.equal(stash.find((e) => e.id === 'medkit').n, 1);
	assert.equal(p.hp, TUNING.maxHp);
});

test('a player with an empty stash still gets a pistol and some ammo, so a raid is always possible', async () => {
	const game = runDeadDrop();
	game.addPlayer('host', 'Host');
	game.equip('host');
	game.game.profileOf('host').stash.length = 0;
	await game.startRaid(['host']);
	const p = game.player('host');
	assert.deepEqual(p.weapons, ['pistol']);
	assert.equal(p.pack.find((e) => e.id === 'ammo9').n, 36);
});

test('four players arrive at four different places in the entry room, each with a gun of their own', async () => {
	const game = await raid(['host', 'ana', 'bo', 'cy']);
	assert.equal(game.teleports.length, 4);
	const spots = new Set(game.teleports.map((t) => t.position.join()));
	assert.equal(spots.size, 4);
	for (const t of game.teleports) assert.deepEqual(cellOf(t.position[0], t.position[2]), layout.entry);
	assert.deepEqual(['host', 'ana', 'bo', 'cy'].map((id) => game.player(id).gun), [0, 1, 2, 3]);
	assert.deepEqual(game.logs, []);
});
