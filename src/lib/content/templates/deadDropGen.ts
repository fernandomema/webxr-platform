export type Cell = [number, number];

export interface Layout {
	seed: number;
	/** The cell the squad arrives in, on the south row. */
	entry: Cell;
	/** `east[z][x]`: whether the wall between cell (x, z) and (x + 1, z) has a doorway. */
	east: boolean[][];
	/** `north[z][x]`: the same between (x, z) and (x, z + 1). */
	north: boolean[][];
	/** What each cell is, indexed `x + z * 3`: entry, exit, vault, storage, barracks, control or hall. */
	roles: string[];
	/** Which of the two prop layouts each cell uses. */
	variants: number[];
	/** Steps from the entry through the doorways. */
	dist: number[];
	/** The three exits; two are open in a given raid. */
	exits: { cell: Cell; active: boolean }[];
	/** Where loot lies: a cell, one of its four corners and how good it is (1 to 3). */
	loot: { cell: Cell; spot: number; tier: number }[];
	/** Each soldier's patrol, as the cells it walks to and fro. */
	soldiers: { route: Cell[] }[];
	/** Turrets sit in a corner of a cell and watch its middle. */
	turrets: { cell: Cell; spot: number }[];
}

/**
 * Makes a raid's map from a seed: a 3 x 3 grid of rooms joined by doorways so that every room can be reached, with a few extra
 * doors to give flanking routes, then decides what each room is and where loot, soldiers and turrets go. The same seed gives the
 * same map. It uses nothing from outside itself, so its source can be put into the game's script (see `GEN_SOURCE`).
 */
export function generateLayout(seed: number): Layout {
	const N = 3;
	let state = seed >>> 0;
	const rnd = (): number => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
	const shuffle = (list: any[]): any[] => {
		const copy = list.slice();
		for (let i = copy.length - 1; i > 0; i--) {
			const j = Math.floor(rnd() * (i + 1));
			const keep = copy[i];
			copy[i] = copy[j];
			copy[j] = keep;
		}
		return copy;
	};
	const index = (x: number, z: number): number => x + z * N;
	const east: boolean[][] = [];
	for (let z = 0; z < N; z++) east.push(new Array(N - 1).fill(false));
	const north: boolean[][] = [];
	for (let z = 0; z < N - 1; z++) north.push(new Array(N).fill(false));
	const setDoor = (x1: number, z1: number, x2: number, z2: number, value: boolean): void => {
		if (z1 === z2) east[z1][Math.min(x1, x2)] = value;
		else north[Math.min(z1, z2)][x1] = value;
	};
	const hasDoor = (x1: number, z1: number, x2: number, z2: number): boolean => (z1 === z2 ? east[z1][Math.min(x1, x2)] : north[Math.min(z1, z2)][x1]);
	const neighbours = (x: number, z: number): Cell[] => {
		const all: Cell[] = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
		return all.filter((cell) => cell[0] >= 0 && cell[0] < N && cell[1] >= 0 && cell[1] < N);
	};

	const entry: Cell = [Math.floor(rnd() * N), 0];

	// A random spanning tree (depth first), so every room can be reached.
	const seen = new Array(N * N).fill(false);
	const stack: Cell[] = [entry];
	seen[index(entry[0], entry[1])] = true;
	while (stack.length) {
		const [x, z] = stack[stack.length - 1];
		const free = shuffle(neighbours(x, z).filter((cell) => !seen[index(cell[0], cell[1])]));
		if (!free.length) {
			stack.pop();
			continue;
		}
		const next: Cell = free[0];
		setDoor(x, z, next[0], next[1], true);
		seen[index(next[0], next[1])] = true;
		stack.push(next);
	}
	// A couple of extra doorways make loops, so there is more than one way round a fight.
	let loops = 2;
	for (let attempt = 0; attempt < 24 && loops > 0; attempt++) {
		const x = Math.floor(rnd() * N);
		const z = Math.floor(rnd() * N);
		const options = shuffle(neighbours(x, z).filter((cell) => !hasDoor(x, z, cell[0], cell[1])));
		if (!options.length) continue;
		setDoor(x, z, options[0][0], options[0][1], true);
		loops--;
	}

	// Distance from the entry, and how many doorways each room has.
	const dist: number[] = new Array(N * N).fill(-1);
	const queue: Cell[] = [entry];
	dist[index(entry[0], entry[1])] = 0;
	for (let head = 0; head < queue.length; head++) {
		const [x, z] = queue[head];
		for (const cell of neighbours(x, z)) {
			if (dist[index(cell[0], cell[1])] >= 0 || !hasDoor(x, z, cell[0], cell[1])) continue;
			dist[index(cell[0], cell[1])] = dist[index(x, z)] + 1;
			queue.push(cell);
		}
	}
	const degree = (x: number, z: number): number => neighbours(x, z).filter((cell) => hasDoor(x, z, cell[0], cell[1])).length;
	const others: Cell[] = [];
	for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (x !== entry[0] || z !== entry[1]) others.push([x, z]);

	const roles: string[] = new Array(N * N).fill('hall');
	roles[index(entry[0], entry[1])] = 'entry';
	// The vault is the furthest dead end (any furthest room if there is none).
	const byDistance = shuffle(others).sort((a: Cell, b: Cell) => dist[index(b[0], b[1])] - dist[index(a[0], a[1])]);
	const deadEnds = byDistance.filter((cell: Cell) => degree(cell[0], cell[1]) === 1);
	const vault: Cell = (deadEnds.length ? deadEnds : byDistance)[0];
	roles[index(vault[0], vault[1])] = 'vault';
	// The exits are the three furthest rooms besides it.
	const exitCells: Cell[] = byDistance.filter((cell: Cell) => cell !== vault).slice(0, 3);
	const open = shuffle([0, 1, 2]).slice(0, 2);
	const exits = exitCells.map((cell: Cell, i: number) => ({ cell, active: open.indexOf(i) >= 0 }));
	for (const cell of exitCells) roles[index(cell[0], cell[1])] = 'exit';
	const kinds = ['storage', 'barracks', 'control', 'hall'];
	for (const cell of others) if (roles[index(cell[0], cell[1])] === 'hall') roles[index(cell[0], cell[1])] = kinds[Math.floor(rnd() * kinds.length)];
	const variants: number[] = [];
	for (let i = 0; i < N * N; i++) variants.push(Math.floor(rnd() * 2));

	// Loot: each room has four corners; richer rooms use more of them.
	const loot: { cell: Cell; spot: number; tier: number }[] = [];
	const give = (cell: Cell, count: number, tierOf: () => number): void => {
		const spots = shuffle([0, 1, 2, 3]);
		for (let i = 0; i < count; i++) loot.push({ cell, spot: spots[i], tier: tierOf() });
	};
	for (const cell of others) {
		const role = roles[index(cell[0], cell[1])];
		if (role === 'vault') give(cell, 4, () => 3);
		else if (role === 'storage') give(cell, 3, () => (rnd() < 0.35 ? 2 : 1));
		else if (role === 'control') give(cell, 2, () => (rnd() < 0.3 ? 3 : 2));
		else if (role === 'barracks') give(cell, 2, () => 1);
		else if (role === 'hall' || role === 'exit') give(cell, 1, () => 1);
	}

	// Soldiers walk a short route through doorways; turrets watch a room from a corner.
	const wanted: Record<string, number> = { vault: 2, barracks: 1, control: 1, storage: 0, hall: 1, exit: 0 };
	const posts: Cell[] = [];
	// Nobody lives next to the way in: the squad gets a quiet room and a quiet doorway to look around from.
	const far = (cell: Cell): boolean => dist[index(cell[0], cell[1])] >= 2;
	for (const cell of others.filter(far)) {
		let count = wanted[roles[index(cell[0], cell[1])]];
		if (roles[index(cell[0], cell[1])] === 'barracks' && rnd() < 0.5) count++;
		for (let i = 0; i < count; i++) posts.push(cell);
	}
	const spare = shuffle(others.filter((cell: Cell) => dist[index(cell[0], cell[1])] >= 2));
	while (posts.length < 6 && spare.length) posts.push(spare[posts.length % spare.length]);
	const soldiers: { route: Cell[] }[] = [];
	for (const start of posts.slice(0, 8)) {
		const route: Cell[] = [start];
		for (let step = 0; step < 2; step++) {
			const here = route[route.length - 1];
			const before = route.length > 1 ? route[route.length - 2] : null;
			const ahead = shuffle(neighbours(here[0], here[1]).filter((cell: Cell) => hasDoor(here[0], here[1], cell[0], cell[1]) && far(cell)));
			const forward = ahead.filter((cell: Cell) => !before || cell[0] !== before[0] || cell[1] !== before[1]);
			const choice = (forward.length ? forward : ahead)[0];
			if (!choice || rnd() < 0.2) break;
			route.push(choice);
		}
		soldiers.push({ route });
	}
	const turrets: { cell: Cell; spot: number }[] = [];
	for (const cell of others.filter(far)) {
		const role = roles[index(cell[0], cell[1])];
		if (role === 'vault' || role === 'control' || ((role === 'hall' || role === 'storage') && rnd() < 0.3)) turrets.push({ cell, spot: Math.floor(rnd() * 4) });
	}

	return { seed: seed >>> 0, entry, east, north, roles, variants, dist, exits, loot, soldiers, turrets: turrets.slice(0, 4) };
}

/** `generateLayout` as the source of a function expression, for the game's script. */
export const GEN_SOURCE = `(${generateLayout.toString()})`;
