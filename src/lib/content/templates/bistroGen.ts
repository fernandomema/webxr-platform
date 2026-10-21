import { HALL } from './bistroData.ts';

export interface Placed {
	kind: string;
	gx: number;
	gz: number;
	/** Quarter turns: a table with 0 has its seats north and south of it, with 1 east and west. */
	turn: number;
}

export interface Layout {
	seed: number;
	name: string;
	/** Cells across, and the first and last column of the hall that the restaurant uses. */
	w: number;
	x0: number;
	x1: number;
	/** Rows of kitchen, from the lobby's wall: the half wall is between row `kitchen - 1` and row `kitchen`. */
	kitchen: number;
	/** The columns where the half wall has a way through. */
	gaps: number[];
	stations: Placed[];
}

/**
 * Makes a restaurant from a seed: how deep the kitchen is, where the half wall between kitchen and dining room lets the cooks
 * through, where the appliances of `kinds` stand (along the walls, along the pass, or both) and how the tables are spread. Every
 * appliance can be walked up to from the door to the lobby, every seat from the street door, and the two rooms join. The same
 * seed gives the same restaurant. It uses nothing from outside itself, so its source can be put into the game's script.
 */
export function generateLayout(seed: number, width: number, kinds: string[], hallW: number, hallD: number): Layout {
	const first = ['Golden', 'Copper', 'Little', 'Green', 'Lucky', 'Old', 'Blue', 'Silver', 'Merry', 'Hungry', 'Crooked', 'Grand'];
	const second = ['Fork', 'Ladle', 'Onion', 'Kettle', 'Pepper', 'Spoon', 'Olive', 'Lemon', 'Rooster', 'Anchor', 'Lantern', 'Apron'];
	const x0 = Math.floor((hallW - width) / 2), x1 = x0 + width - 1;
	const doorA = Math.floor(hallW / 2) - 1, doorB = doorA + 1;
	const key = (gx: number, gz: number): number => gx * 100 + gz;

	const attempt = (salt: number): Layout | null => {
		// Mulberry32: seeds that are next to each other still give restaurants that have nothing in common.
		let state = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
		const rnd = (): number => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		const shuffle = (list: any[]): any[] => {
			const copy = list.slice();
			for (let i = copy.length - 1; i > 0; i--) {
				const j = Math.floor(rnd() * (i + 1));
				[copy[i], copy[j]] = [copy[j], copy[i]];
			}
			return copy;
		};
		const kitchen = 3 + (rnd() < 0.5 ? 1 : 0);
		// One way through the half wall in a small restaurant, two in the others, never on the edge.
		const inner = [];
		for (let gx = x0 + 1; gx <= x1 - 1; gx++) inner.push(gx);
		const order = shuffle(inner);
		const gaps = [order[0]];
		if (width >= 8) {
			const far = order.find((gx: number) => Math.abs(gx - order[0]) >= 3);
			if (far !== undefined) gaps.push(far);
		}
		gaps.sort((a, b) => a - b);

		// Cells that stay clear: in front of both doors, and each side of a way through the half wall.
		const clear = new Set<number>();
		for (const gx of [doorA, doorB]) { clear.add(key(gx, 0)); clear.add(key(gx, 1)); clear.add(key(gx, hallD - 1)); clear.add(key(gx, hallD - 2)); }
		for (const gx of gaps) { clear.add(key(gx, kitchen - 1)); clear.add(key(gx, kitchen)); }

		const taken = new Set<number>();
		const stations: Placed[] = [];
		const free = (gx: number, gz: number): boolean => gx >= x0 && gx <= x1 && gz >= 0 && gz < hallD && !taken.has(key(gx, gz)) && !clear.has(key(gx, gz));
		const put = (kind: string, gx: number, gz: number, turn: number): void => { taken.add(key(gx, gz)); stations.push({ kind, gx, gz, turn }); };

		/** The cells a cook can walk to from the door to the lobby. */
		const flood = (from: [number, number]): Set<number> => {
			const seen = new Set<number>([key(from[0], from[1])]);
			const queue = [from];
			while (queue.length) {
				const [gx, gz] = queue.shift() as [number, number];
				for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const nx = gx + dx, nz = gz + dz;
					if (nx < x0 || nx > x1 || nz < 0 || nz >= hallD || seen.has(key(nx, nz)) || taken.has(key(nx, nz))) continue;
					if (dz !== 0 && Math.min(gz, nz) === kitchen - 1 && !gaps.includes(gx)) continue;
					seen.add(key(nx, nz));
					queue.push([nx, nz]);
				}
			}
			return seen;
		};
		/** Whether every appliance can still be used: from a cell beside it, on the kitchen's side of the half wall. */
		const usable = (): boolean => {
			const staff = flood([doorA, 0]);
			if (!staff.has(key(doorA, hallD - 1))) return false;
			return stations.every((s) => s.kind === 'table' || s.kind === 'plant' || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => s.gz + dz < kitchen && staff.has(key(s.gx + dx, s.gz + dz))));
		};

		// The kitchen: lines of cells along its walls and along the pass, taken in an order the seed chooses. A cell that
		// would shut another appliance in (a corner, with its two neighbours full) is passed over.
		const lines: Record<string, [number, number][]> = { south: [], west: [], east: [], pass: [] };
		for (let gx = x0; gx <= x1; gx++) lines.south.push([gx, 0]);
		for (let gz = 1; gz < kitchen; gz++) { lines.west.push([x0, gz]); lines.east.push([x1, gz]); }
		for (let gx = x0 + 1; gx <= x1 - 1; gx++) lines.pass.push([gx, kitchen - 1]);
		const plans = [['pass', 'west', 'south', 'east'], ['south', 'west', 'east', 'pass'], ['west', 'south', 'east', 'pass'], ['east', 'pass', 'south', 'west'], ['south', 'east', 'pass', 'west']];
		const plan = plans[Math.floor(rnd() * plans.length)];
		const cells: [number, number][] = [];
		for (const name of plan) for (const cell of rnd() < 0.5 ? lines[name] : lines[name].slice().reverse()) if (!cells.some((c) => c[0] === cell[0] && c[1] === cell[1])) cells.push(cell);
		const kitchenKinds = kinds.filter((kind) => kind !== 'table' && kind !== 'plant');
		let at = 0;
		for (const kind of kitchenKinds) {
			let done = false;
			while (!done && at < cells.length) {
				const [gx, gz] = cells[at++];
				if (!free(gx, gz)) continue;
				put(kind, gx, gz, 0);
				if (usable()) done = true;
				else { taken.delete(key(gx, gz)); stations.pop(); }
			}
			if (!done) return null;
		}

		// The dining room: tables on a board of alternate cells, each with the cell in front of each seat kept free.
		const spots: [number, number][] = [];
		const offset = rnd() < 0.5 ? 0 : 1;
		for (let gz = kitchen + 1; gz <= hallD - 2; gz++) for (let gx = x0; gx <= x1; gx++) if ((gx + gz + offset) % 2 === 0) spots.push([gx, gz]);
		const tables = kinds.filter((kind) => kind === 'table').length;
		let placed = 0;
		for (const [gx, gz] of shuffle(spots)) {
			if (placed >= tables) break;
			if (!free(gx, gz)) continue;
			const turns = rnd() < 0.5 ? [0, 1] : [1, 0];
			for (const turn of turns) {
				const a: [number, number] = turn ? [gx - 1, gz] : [gx, gz - 1];
				const b: [number, number] = turn ? [gx + 1, gz] : [gx, gz + 1];
				const open = (c: [number, number]): boolean => c[0] >= x0 && c[0] <= x1 && c[1] >= kitchen && c[1] < hallD && !taken.has(key(c[0], c[1]));
				if (!open(a) || !open(b)) continue;
				put('table', gx, gz, turn);
				clear.add(key(a[0], a[1])); clear.add(key(b[0], b[1]));
				placed++;
				break;
			}
		}
		if (placed < tables) return null;
		for (const kind of kinds.filter((k) => k === 'plant')) {
			const corner = shuffle([[x0, hallD - 1], [x1, hallD - 1], [x0, kitchen], [x1, kitchen]]).find((c: [number, number]) => free(c[0], c[1]));
			if (corner) put(kind, corner[0], corner[1], 0);
		}

		// Check it: every seat can be walked to from the street door, and nothing was shut in on the way.
		if (!usable()) return null;
		const guests = flood([doorA, hallD - 1]);
		for (const s of stations) {
			if (s.kind !== 'table') continue;
			const a = s.turn ? key(s.gx - 1, s.gz) : key(s.gx, s.gz - 1), b = s.turn ? key(s.gx + 1, s.gz) : key(s.gx, s.gz + 1);
			if (!guests.has(a) || !guests.has(b)) return null;
		}
		const name = 'The ' + first[Math.floor(rnd() * first.length)] + ' ' + second[Math.floor(rnd() * second.length)];
		return { seed: seed >>> 0, name, w: width, x0, x1, kitchen, gaps, stations };
	};

	for (let salt = 0; salt < 60; salt++) {
		const layout = attempt(salt);
		if (layout) return layout;
	}
	throw new Error('No restaurant could be made from seed ' + seed);
}

/** What the floor of a restaurant is like for somebody walking: where it ends, where the half wall is, and which cells are full. */
export interface Floor {
	x0: number;
	x1: number;
	kitchen: number;
	gaps: number[];
	/** Cells with something standing in them, as `gx * 100 + gz`. */
	blocked: number[];
}

/**
 * The shortest way over the floor from one cell to another, as the cells to step through (the first one left out), or null. The
 * last cell may be a full one: that is how a guest gets to a chair. Self-contained, like `generateLayout`.
 */
export function findPath(floor: Floor, from: [number, number], to: [number, number], hallD: number): [number, number][] | null {
	const key = (gx: number, gz: number): number => gx * 100 + gz;
	const blocked = new Set(floor.blocked);
	const goal = key(to[0], to[1]);
	const prev = new Map<number, number>();
	const seen = new Set<number>([key(from[0], from[1])]);
	const queue: [number, number][] = [from];
	while (queue.length) {
		const [gx, gz] = queue.shift() as [number, number];
		if (key(gx, gz) === goal) {
			const path: [number, number][] = [];
			for (let k = goal; k !== key(from[0], from[1]); k = prev.get(k) as number) path.unshift([Math.floor(k / 100), k % 100]);
			return path;
		}
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = gx + dx, nz = gz + dz, k = key(nx, nz);
			if (nx < floor.x0 || nx > floor.x1 || nz < 0 || nz >= hallD || seen.has(k)) continue;
			if (blocked.has(k) && k !== goal) continue;
			if (dz !== 0 && Math.min(gz, nz) === floor.kitchen - 1 && !floor.gaps.includes(gx)) continue;
			seen.add(k);
			prev.set(k, key(gx, gz));
			queue.push([nx, nz]);
		}
	}
	return null;
}

/** The functions as source, for the game's script. */
export const GEN_SOURCE = `(${generateLayout.toString()})`;
export const PATH_SOURCE = `(${findPath.toString()})`;

export const layoutFor = (seed: number, width: number, kinds: string[]): Layout => generateLayout(seed, width, kinds, HALL.w, HALL.d);
