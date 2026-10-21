import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISHES, HALL, KINDS, MODELS, SIZES, STARTER_KIT } from '../src/lib/content/templates/bistroData.ts';
import { findPath, layoutFor } from '../src/lib/content/templates/bistroGen.ts';

const key = (gx, gz) => gx * 100 + gz;
const DOORS = [HALL.w / 2 - 1, HALL.w / 2];
/** What a restaurant starts with when its first dish is `dish`, as the game works it out. */
const kit = (dish) => [...DISHES[dish].needs.map((model) => Object.keys(KINDS).find((kind) => KINDS[kind].model === model && !KINDS[kind].upgrade)), ...STARTER_KIT];
const floorOf = (layout) => ({ x0: layout.x0, x1: layout.x1, kitchen: layout.kitchen, gaps: layout.gaps, blocked: layout.stations.map((s) => key(s.gx, s.gz)) });

test('the same seed makes the same restaurant, and the next seed a different one', () => {
	assert.deepEqual(layoutFor(42, 6, kit('salad')), layoutFor(42, 6, kit('salad')));
	const a = layoutFor(42, 6, kit('salad')), b = layoutFor(43, 6, kit('salad'));
	assert.notDeepEqual(a.stations, b.stations);
});

test('restaurants differ: names, how deep the kitchen is, where the half wall opens, how the tables face', () => {
	const names = new Set(), kitchens = new Set(), gaps = new Set(), turns = new Set();
	for (let seed = 1; seed <= 200; seed++) {
		const layout = layoutFor(seed, 8, kit('burger'));
		names.add(layout.name); kitchens.add(layout.kitchen); gaps.add(layout.gaps.join());
		for (const s of layout.stations) if (s.kind === 'table') turns.add(s.turn);
	}
	assert.ok(names.size > 40, `${names.size} names`);
	assert.deepEqual([...kitchens].sort(), [3, 4]);
	assert.ok(gaps.size >= 5, `${gaps.size} ways through the half wall`);
	assert.deepEqual([...turns].sort(), [0, 1]);
});

test('every restaurant can be played, for every seed, size and first dish', () => {
	for (let seed = 1; seed <= 1500; seed++) {
		for (const width of Object.values(SIZES)) {
			const dish = seed % 2 ? 'salad' : 'burger';
			const wanted = kit(dish);
			const layout = layoutFor(seed * 31 + 7, width, wanted);
			const where = `seed ${seed}, ${width} wide`;
			assert.equal(layout.x1 - layout.x0 + 1, width);
			assert.equal(layout.x0, (HALL.w - width) / 2);
			assert.deepEqual(layout.stations.map((s) => s.kind).sort(), [...wanted].sort(), `${where}: everything of the kit is there, once`);
			const cells = new Set();
			for (const s of layout.stations) {
				assert.ok(s.gx >= layout.x0 && s.gx <= layout.x1 && s.gz >= 0 && s.gz < HALL.d, `${where}: ${s.kind} is in the hall`);
				assert.ok(!(DOORS.includes(s.gx) && (s.gz === 0 || s.gz === HALL.d - 1)), `${where}: the doors are clear`);
				assert.ok(!cells.has(key(s.gx, s.gz)), `${where}: one thing to a cell`);
				cells.add(key(s.gx, s.gz));
				if (s.kind === 'table') assert.ok(s.gz >= layout.kitchen, `${where}: tables are in the dining room`);
				else assert.ok(s.gz < layout.kitchen, `${where}: appliances are in the kitchen`);
			}
			// The half wall has its ways through, away from its ends.
			assert.ok(layout.gaps.length >= 1 && layout.gaps.every((g) => g > layout.x0 && g < layout.x1), `${where}: gaps ${layout.gaps}`);
			const floor = floorOf(layout);
			// A cook gets from the lobby door to the street door.
			assert.ok(findPath(floor, [DOORS[0], 0], [DOORS[0], HALL.d - 1], HALL.d), `${where}: the kitchen and the dining room join`);
			for (const s of layout.stations) {
				if (s.kind === 'table') {
					// A guest gets from the street door to the cell in front of each seat.
					for (const seat of s.turn ? [[s.gx - 1, s.gz], [s.gx + 1, s.gz]] : [[s.gx, s.gz - 1], [s.gx, s.gz + 1]]) {
						assert.ok(!cells.has(key(seat[0], seat[1])), `${where}: the seat's cell is free`);
						const way = findPath(floor, [DOORS[0], HALL.d - 1], seat, HALL.d);
						assert.ok(way, `${where}: a guest can walk to the seat at ${seat}`);
						assert.ok(way.every(([, gz]) => gz >= layout.kitchen), `${where}: and never through the kitchen`);
					}
				} else {
					// A cook can stand beside every appliance, on the kitchen's side of the half wall.
					const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => s.gz + dz < layout.kitchen && s.gz + dz >= 0 && !cells.has(key(s.gx + dx, s.gz + dz)) && findPath(floor, [DOORS[0], 0], [s.gx + dx, s.gz + dz], HALL.d));
					assert.ok(beside, `${where}: ${s.kind} at ${s.gx},${s.gz} can be reached`);
				}
			}
		}
	}
});

test('the kit never asks for more of a shape than the world has', () => {
	for (const dish of Object.keys(DISHES).filter((id) => DISHES[id].starter)) {
		const count = {};
		for (const kind of kit(dish)) count[KINDS[kind].model] = (count[KINDS[kind].model] ?? 0) + 1;
		for (const [model, n] of Object.entries(count)) assert.ok(n <= MODELS[model], `${dish}: ${n} ${model}`);
	}
});

test('a way over the floor goes round what stands on it and through the half wall only where it opens', () => {
	const floor = { x0: 2, x1: 7, kitchen: 3, gaps: [5], blocked: [key(4, 4), key(3, 1)] };
	const way = findPath(floor, [2, 0], [2, 6], HALL.d);
	assert.ok(way);
	assert.deepEqual(way[way.length - 1], [2, 6]);
	let previous = [2, 0];
	for (const [gx, gz] of way) {
		assert.equal(Math.abs(gx - previous[0]) + Math.abs(gz - previous[1]), 1, 'one cell at a time');
		assert.ok(gx >= 2 && gx <= 7 && gz >= 0 && gz < HALL.d, 'inside the restaurant');
		assert.ok(!floor.blocked.includes(key(gx, gz)), 'not through an appliance');
		if (gz !== previous[1] && Math.min(gz, previous[1]) === 2) assert.equal(gx, 5, 'through the gap');
		previous = [gx, gz];
	}
	assert.equal(findPath({ ...floor, gaps: [] }, [2, 0], [2, 6], HALL.d), null, 'no gap, no way');
	assert.deepEqual(findPath(floor, [3, 4], [4, 4], HALL.d), [[4, 4]], 'the last cell may be a full one: a chair');
	assert.deepEqual(findPath(floor, [2, 0], [2, 0], HALL.d), []);
});
