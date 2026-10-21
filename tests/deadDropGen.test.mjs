import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEN_SOURCE, generateLayout } from '../src/lib/content/templates/deadDropGen.ts';
import { POOLS } from '../src/lib/content/templates/deadDropData.ts';

const SEEDS = Array.from({ length: 400 }, (_, i) => i * 7919 + 13);
const N = 3;
const idx = (x, z) => x + z * N;
const door = (layout, x1, z1, x2, z2) => (z1 === z2 ? layout.east[z1][Math.min(x1, x2)] : layout.north[Math.min(z1, z2)][x1]);
const around = (x, z) => [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].filter(([a, b]) => a >= 0 && a < N && b >= 0 && b < N);
const reach = (layout, from) => {
	const seen = new Set([idx(...from)]);
	const queue = [from];
	for (let head = 0; head < queue.length; head++) {
		const [x, z] = queue[head];
		for (const next of around(x, z)) if (door(layout, x, z, ...next) && !seen.has(idx(...next))) { seen.add(idx(...next)); queue.push(next); }
	}
	return seen;
};

test('the same seed always makes the same map, and different seeds make different ones', () => {
	assert.deepEqual(generateLayout(42), generateLayout(42));
	const shapes = new Set(SEEDS.map((seed) => JSON.stringify([generateLayout(seed).east, generateLayout(seed).north])));
	assert.ok(shapes.size > 40, `${shapes.size} distinct door layouts in ${SEEDS.length} seeds`);
	const vaults = new Set(SEEDS.map((seed) => generateLayout(seed).roles.indexOf('vault')));
	assert.ok(vaults.size >= 4, 'the vault is not always in the same place');
});

test('every room can be reached from the entry, which is on the south row', () => {
	for (const seed of SEEDS) {
		const layout = generateLayout(seed);
		assert.equal(layout.entry[1], 0, `seed ${seed}: entry on the south row`);
		assert.equal(reach(layout, layout.entry).size, N * N, `seed ${seed}: all nine rooms connected`);
		assert.equal(layout.dist[idx(...layout.entry)], 0);
		assert.ok(layout.dist.every((d) => d >= 0), `seed ${seed}: every distance known`);
		assert.equal(layout.east.length, N);
		assert.ok(layout.east.every((row) => row.length === N - 1));
		assert.equal(layout.north.length, N - 1);
		assert.ok(layout.north.every((row) => row.length === N));
	}
});

test('there are loops as well as a tree, so a fight can be flanked', () => {
	const doors = (layout) => layout.east.flat().filter(Boolean).length + layout.north.flat().filter(Boolean).length;
	for (const seed of SEEDS) assert.ok(doors(generateLayout(seed)) >= N * N, `seed ${seed}: more doorways than a tree has`);
});

test('exactly one entry, one vault and three exits of which two are open, all in different rooms', () => {
	for (const seed of SEEDS) {
		const layout = generateLayout(seed);
		const count = (role) => layout.roles.filter((r) => r === role).length;
		assert.equal(count('entry'), 1);
		assert.equal(count('vault'), 1);
		assert.equal(count('exit'), 3, `seed ${seed}`);
		assert.equal(layout.exits.length, 3);
		assert.equal(layout.exits.filter((exit) => exit.active).length, 2);
		for (const exit of layout.exits) assert.equal(layout.roles[idx(...exit.cell)], 'exit');
		assert.ok(layout.exits.every((exit) => layout.dist[idx(...exit.cell)] >= 1), 'no exit at the entry');
		for (const role of layout.roles) assert.ok(['entry', 'exit', 'vault', 'storage', 'barracks', 'control', 'hall'].includes(role));
	}
});

test('the vault is a dead end whenever the map has one, and is far from the way in', () => {
	let dead = 0;
	for (const seed of SEEDS) {
		const layout = generateLayout(seed);
		const at = layout.roles.indexOf('vault');
		const x = at % N, z = Math.floor(at / N);
		const degree = around(x, z).filter((next) => door(layout, x, z, ...next)).length;
		if (degree === 1) dead++;
		assert.ok(layout.dist[at] >= 2, `seed ${seed}: the vault is at least two rooms from the entry`);
	}
	assert.ok(dead > SEEDS.length * 0.5, `${dead} of ${SEEDS.length} vaults are dead ends`);
});

test('loot, soldiers and turrets fit in the pools the world has, and keep to their rooms', () => {
	for (const seed of SEEDS) {
		const layout = generateLayout(seed);
		assert.ok(layout.loot.length >= 8 && layout.loot.length <= POOLS.loot, `seed ${seed}: ${layout.loot.length} loot spots`);
		assert.ok(layout.soldiers.length >= 6 && layout.soldiers.length <= POOLS.soldiers, `seed ${seed}: ${layout.soldiers.length} soldiers`);
		assert.ok(layout.turrets.length <= POOLS.turrets);
		const spots = new Set();
		for (const spot of layout.loot) {
			assert.ok(spot.spot >= 0 && spot.spot < 4 && spot.tier >= 1 && spot.tier <= 3);
			assert.ok(!spots.has(`${spot.cell}-${spot.spot}`), 'one thing per corner');
			spots.add(`${spot.cell}-${spot.spot}`);
			assert.notEqual(layout.roles[idx(...spot.cell)], 'entry', 'nothing to loot at the entry');
		}
		for (const { route } of layout.soldiers) {
			assert.ok(route.length >= 1 && route.length <= 3);
			assert.ok(route.every((cell) => layout.roles[idx(...cell)] !== 'entry'), 'soldiers never walk through the entry');
			for (let i = 1; i < route.length; i++) assert.ok(door(layout, ...route[i - 1], ...route[i]), 'a patrol only goes through doorways');
		}
		for (const turret of layout.turrets) {
			assert.ok(turret.spot >= 0 && turret.spot < 4);
			assert.ok(!['entry', 'exit'].includes(layout.roles[idx(...turret.cell)]));
		}
	}
});

test('the vault holds the best loot', () => {
	for (const seed of SEEDS.slice(0, 80)) {
		const layout = generateLayout(seed);
		const vault = layout.roles.indexOf('vault');
		const inVault = layout.loot.filter((spot) => idx(...spot.cell) === vault);
		assert.equal(inVault.length, 4);
		assert.ok(inVault.every((spot) => spot.tier === 3));
	}
});

test('the embedded source builds the very same map as the function, so the game and the tests agree', () => {
	const embedded = new Function(`return ${GEN_SOURCE}`)();
	for (const seed of SEEDS.slice(0, 60)) assert.deepEqual(embedded(seed), generateLayout(seed));
});
