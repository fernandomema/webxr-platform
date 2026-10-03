import type { Slot, SlotTree } from '$lib/ecs/types';
import { createSlot } from '$lib/ecs/types';

/**
 * A mirror maze, built so the player doubts what they see.
 *
 * The real route is a small maze of 2 m corridors under a ceiling. Every wall is one of three surfaces that look alike from a
 * distance: a mirror, a pane of glass or a silver opaque wall. Where they go decides the lie each one tells:
 *  - a dead end closed by a mirror (and mirrored sides) looks like a corridor that goes on for ever;
 *  - a dead end closed by a 45° mirror looks like a corridor that turns;
 *  - glass shows another corridor, or another player, that cannot be reached from here;
 *  - the central room is full of mirrors turned 30°, 45° and 60°, so its real size and exits cannot be read.
 * The way in and the way out are plain on purpose; the middle is where it is hardest to understand.
 * The floor and ceiling repeat one pattern everywhere, so they give no landmarks.
 *
 * North is +Z: the desktop camera starts at (0, 1.6, 2), looking along +Z.
 */
const COLS = 5;
const ROWS = 7;
const P = 2;
const HEIGHT = 3;
const THICKNESS = 0.1;
const START_Z = 2;
const START_COL = 2;
/** The room in the middle with no inner walls: its columns and rows. */
const ROOM = { c0: 1, c1: 2, r0: 2, r1: 3 };
const MIRROR_RESOLUTION = 384;
const SEED = 7;
/** The opaque wall is the colour of a mirror's tint, so the two are hard to tell apart from afar. */
const SILVER = '#d1e0f0';
const GLASS = '#cfe8ff';

type Skin = 'mirror' | 'glass' | 'plain';

const makeRand = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 0x100000000;
	};
};

const cellX = (c: number) => (c - START_COL) * P;
const cellZ = (r: number) => START_Z + r * P;
const yawQuat = (theta: number): [number, number, number, number] => [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)];

interface Layout {
	/** `south[r][c]`: the wall between (c, r - 1) and (c, r) is open; `r` runs 0..ROWS (0 and ROWS are the outer walls). */
	south: boolean[][];
	/** `west[r][c]`: the wall between (c - 1, r) and (c, r) is open; `c` runs 0..COLS. */
	west: boolean[][];
	depth: number[][];
	exit: number;
}

export function layoutMaze(seed = SEED): Layout {
	const rand = makeRand(seed);
	const south = Array.from({ length: ROWS + 1 }, () => Array<boolean>(COLS).fill(false));
	const west = Array.from({ length: ROWS }, () => Array<boolean>(COLS + 1).fill(false));
	const seen = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
	const stack: [number, number][] = [[START_COL, 0]];
	seen[0][START_COL] = true;
	while (stack.length) {
		const [c, r] = stack[stack.length - 1];
		const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
			.map(([dc, dr]) => [c + dc, r + dr] as const)
			.filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !seen[nr][nc]);
		if (!next.length) { stack.pop(); continue; }
		const [nc, nr] = next[Math.floor(rand() * next.length)];
		if (nr !== r) south[Math.max(r, nr)][c] = true;
		else west[r][Math.max(c, nc)] = true;
		seen[nr][nc] = true;
		stack.push([nc, nr]);
	}
	// The middle room: no walls inside it.
	for (let r = ROOM.r0; r <= ROOM.r1; r++) for (let c = ROOM.c0 + 1; c <= ROOM.c1; c++) west[r][c] = true;
	for (let r = ROOM.r0 + 1; r <= ROOM.r1; r++) for (let c = ROOM.c0; c <= ROOM.c1; c++) south[r][c] = true;

	const depth = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(-1));
	depth[0][START_COL] = 0;
	const queue: [number, number][] = [[START_COL, 0]];
	for (let i = 0; i < queue.length; i++) {
		const [c, r] = queue[i];
		const links: [number, number, boolean][] = [
			[c, r + 1, r + 1 < ROWS && south[r + 1][c]], [c, r - 1, r > 0 && south[r][c]],
			[c + 1, r, c + 1 < COLS && west[r][c + 1]], [c - 1, r, c > 0 && west[r][c]]
		];
		for (const [nc, nr, open] of links) {
			if (open && depth[nr][nc] < 0) { depth[nr][nc] = depth[r][c] + 1; queue.push([nc, nr]); }
		}
	}
	let exit = 0;
	for (let c = 1; c < COLS; c++) if (depth[ROWS - 1][c] > depth[ROWS - 1][exit]) exit = c;
	return { south, west, depth, exit };
}

export function buildMirrorMaze(): SlotTree {
	const rand = makeRand(SEED * 977);
	const { south, west, depth, exit } = layoutMaze();
	const slots: Slot[] = [];
	const width = COLS * P;
	const length = ROWS * P;
	const centerZ = START_Z + ((ROWS - 1) * P) / 2;
	const routeLength = depth[ROWS - 1][exit];

	const openCount = (c: number, r: number) =>
		(r + 1 < ROWS && south[r + 1][c] ? 1 : 0) + (r > 0 && south[r][c] ? 1 : 0) +
		(c + 1 < COLS && west[r][c + 1] ? 1 : 0) + (c > 0 && west[r][c] ? 1 : 0) + (r === ROWS - 1 && c === exit ? 1 : 0);
	const deadEnd = (c: number, r: number) => openCount(c, r) === 1 && !(c === START_COL && r === 0) && !(r === ROWS - 1 && c === exit);
	const inRoom = (c: number, r: number) => c >= ROOM.c0 && c <= ROOM.c1 && r >= ROOM.r0 && r <= ROOM.r1;

	const box = (id: string, name: string, position: [number, number, number], scale: [number, number, number], color: string, options: { yaw?: number; collider?: boolean; opacity?: number } = {}) =>
		slots.push(createSlot({
			id, name, position, rotation: yawQuat(options.yaw ?? 0), scale,
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color, ...(options.opacity !== undefined ? { opacity: options.opacity } : {}) },
				...(options.collider === false ? [] : [{ type: 'collider' as const, shape: 'box' as const }])
			]
		}));

	// --- Floor and ceiling: one pattern, repeated, with nothing to memorise ---
	slots.push(
		createSlot({ id: 'mirror-maze-skybox', name: 'Skybox', components: [{ type: 'skybox', topColor: '#020617', horizonColor: '#312e81', bottomColor: '#020617', stars: 0.5 }] }),
		createSlot({
			id: 'mirror-maze-floor',
			name: 'Floor',
			position: [0, 0, centerZ + 2],
			// Only 'ground' and 'disc' meshes count as floor to stand on; a ground is 20 m across.
			scale: [(width + 10) / 20, 1, (length + 14) / 20],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#0f172a' }, { type: 'collider', shape: 'box' }]
		})
	);
	for (let c = 0; c <= COLS; c++) box(`mirror-maze-floor-line-x${c}`, 'Floor Line', [(c - 0.5 - START_COL) * P, 0.004, centerZ], [0.04, 0.008, length], '#475569', { collider: false });
	for (let r = 0; r <= ROWS; r++) box(`mirror-maze-floor-line-z${r}`, 'Floor Line', [0, 0.004, cellZ(r) - P / 2], [width, 0.008, 0.04], '#475569', { collider: false });
	box('mirror-maze-ceiling', 'Ceiling', [0, HEIGHT + 0.05, centerZ], [width + 0.4, 0.1, length + 0.4], '#1e293b', { collider: false });
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) box(`mirror-maze-lamp-${c}-${r}`, 'Ceiling Lamp', [cellX(c), HEIGHT - 0.02, cellZ(r)], [0.9, 0.04, 0.9], '#fff7d6', { collider: false });
	}

	// --- Walls: each one's surface, then merged into runs so a long mirror is one mirror ---
	interface Edge { horizontal: boolean; line: number; index: number; skin: Skin; outer: boolean }
	const edges: Edge[] = [];
	const skinFor = (x: number, z: number, cells: [number, number][], outer: boolean): Skin => {
		const d = Math.hypot(x / (width / 2), (z - centerZ) / (length / 2));
		const near = Math.min(...cells.map(([c, r]) => depth[r][c]));
		const far = Math.max(...cells.map(([c, r]) => depth[r][c]));
		if (near <= 1 || far >= routeLength - 1) return 'plain'; // a plain way in and a plain way out
		if (cells.some(([c, r]) => deadEnd(c, r))) return 'mirror'; // a corridor that seems to go on
		const roll = rand();
		if (d < 0.5) return roll < 0.45 ? 'mirror' : roll < 0.75 && !outer ? 'glass' : 'plain';
		if (d < 0.9) return roll < 0.35 ? 'mirror' : roll < 0.55 && !outer ? 'glass' : 'plain';
		return roll < 0.12 ? 'mirror' : 'plain';
	};
	for (let r = 0; r <= ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			if (r > 0 && r < ROWS && south[r][c]) continue;
			if (r === ROWS && c === exit) continue; // the way out
			const outer = r === 0 || r === ROWS;
			const cells: [number, number][] = [];
			if (r > 0) cells.push([c, r - 1]);
			if (r < ROWS) cells.push([c, r]);
			edges.push({ horizontal: true, line: r, index: c, outer, skin: skinFor(cellX(c), cellZ(r) - P / 2, cells, outer) });
		}
	}
	for (let c = 0; c <= COLS; c++) {
		for (let r = 0; r < ROWS; r++) {
			if (c > 0 && c < COLS && west[r][c]) continue;
			const outer = c === 0 || c === COLS;
			const cells: [number, number][] = [];
			if (c > 0) cells.push([c - 1, r]);
			if (c < COLS) cells.push([c, r]);
			edges.push({ horizontal: false, line: c, index: r, outer, skin: skinFor(cellX(c) - P / 2, cellZ(r), cells, outer) });
		}
	}

	// The 45° mirrors close the two deepest dead ends: from the corridor they read as a turn that is not there.
	const diagonals = new Set<string>();
	const deadEnds: [number, number][] = [];
	for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (deadEnd(c, r) && depth[r][c] > 3 && !inRoom(c, r)) deadEnds.push([c, r]);
	deadEnds.sort((a, b) => depth[b[1]][b[0]] - depth[a[1]][a[0]]);
	const diagonalCells = deadEnds.slice(0, 2);
	for (const [c, r] of diagonalCells) diagonals.add(`${c},${r}`);

	let wallIndex = 0;
	const plane = (id: string, x: number, z: number, theta: number, runLength: number) => {
		const nx = -Math.sin(theta);
		const nz = -Math.cos(theta);
		slots.push(createSlot({
			id,
			name: 'Mirror',
			position: [x + nx * (THICKNESS / 2 + 0.01), HEIGHT / 2, z + nz * (THICKNESS / 2 + 0.01)],
			rotation: yawQuat(theta),
			scale: [runLength, HEIGHT - 0.1, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } }, { type: 'mirror', resolution: MIRROR_RESOLUTION }]
		}));
	};
	/** `faces` are the directions (as plane turns) the mirror faces look: both sides of an inner wall, or the inside of an outer one. */
	const placeWall = (skin: Skin, x: number, z: number, runLength: number, yaw: number, faces: number[]) => {
		const id = `mirror-maze-wall-${wallIndex++}`;
		const body = skin === 'glass'
			? { color: GLASS, opacity: 0.16 }
			: { color: skin === 'plain' ? SILVER : '#64748b' };
		box(id, skin === 'glass' ? 'Glass' : skin === 'mirror' ? 'Mirror Wall' : 'Wall', [x, HEIGHT / 2, z], [runLength, HEIGHT, THICKNESS], body.color, { yaw, opacity: body.opacity });
		if (skin !== 'mirror') return;
		faces.forEach((theta, i) => plane(`${id}-${i}`, x, z, theta, runLength - 0.14));
	};

	for (const horizontal of [true, false]) {
		const lines = horizontal ? ROWS + 1 : COLS + 1;
		for (let line = 0; line < lines; line++) {
			const along = edges.filter((e) => e.horizontal === horizontal && e.line === line).sort((a, b) => a.index - b.index);
			for (let i = 0; i < along.length;) {
				let j = i;
				while (j + 1 < along.length && along[j + 1].index === along[j].index + 1 && along[j + 1].skin === along[i].skin) j++;
				const first = along[i];
				const count = j - i + 1;
				const mid = (first.index + along[j].index) / 2;
				// A plane turned by θ faces (-sin θ, -cos θ). Along X the wall's yaw is 0; along Z it is a quarter turn.
				const yaw = horizontal ? 0 : Math.PI / 2;
				const inward = horizontal ? (line === 0 ? Math.PI : 0) : (line === 0 ? -Math.PI / 2 : Math.PI / 2);
				const faces = first.outer ? [inward] : [yaw, yaw + Math.PI];
				if (horizontal) placeWall(first.skin, cellX(mid), cellZ(line) - P / 2, count * P + THICKNESS, yaw, faces);
				else placeWall(first.skin, cellX(line) - P / 2, cellZ(mid), count * P + THICKNESS, yaw, faces);
				i = j + 1;
			}
		}
	}
	// A 45° mirror across the end of each of those dead ends, with the true end wall left plain behind it.
	for (const [c, r] of diagonalCells) {
		const open = [
			{ dx: 0, dz: -1, on: r > 0 && south[r][c] }, { dx: 0, dz: 1, on: r + 1 < ROWS && south[r + 1][c] },
			{ dx: -1, dz: 0, on: c > 0 && west[r][c] }, { dx: 1, dz: 0, on: c + 1 < COLS && west[r][c + 1] }
		].find((o) => o.on);
		if (!open) continue;
		// The corridor enters from `open`; the diagonal runs from one far corner to the near corner on the other side, facing the entrance.
		const side = rand() < 0.5 ? 1 : -1;
		const px = open.dz !== 0 ? side : 0; // a perpendicular step
		const pz = open.dx !== 0 ? side : 0;
		const x = cellX(c);
		const z = cellZ(r);
		const length45 = P * Math.SQRT2 - 0.2;
		// Direction of the diagonal in the plane: from (-open + perp) to (open - perp).
		const dirX = open.dx - px;
		const dirZ = open.dz - pz;
		const yaw = Math.atan2(-dirZ, dirX) ; // rotates +X onto (dirX, dirZ) in Babylon's left-handed Y rotation
		const front = [open.dx, open.dz];
		const wallId = `mirror-maze-diagonal-${c}-${r}`;
		box(wallId, 'Mirror Wall', [x, HEIGHT / 2, z], [length45, HEIGHT, THICKNESS], '#64748b', { yaw });
		// Face the side the entrance is on.
		const normals = [[-dirZ, dirX], [dirZ, -dirX]];
		const toward = normals.find(([nx, nz]) => nx * front[0] + nz * front[1] > 0) ?? normals[0];
		const theta = Math.atan2(-toward[0], -toward[1]);
		slots.push(createSlot({
			id: `${wallId}-mirror`,
			name: 'Mirror',
			position: [x + toward[0] * (THICKNESS / 2 + 0.01), HEIGHT / 2, z + toward[1] * (THICKNESS / 2 + 0.01)],
			rotation: yawQuat(theta),
			scale: [length45 - 0.1, HEIGHT - 0.1, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } }, { type: 'mirror', resolution: MIRROR_RESOLUTION }]
		}));
	}

	// --- The middle room: mirrors at 30°, 45° and 60°, and a pillar of glass, so its size and exits cannot be read ---
	const roomX = (cellX(ROOM.c0) + cellX(ROOM.c1)) / 2;
	const roomZ = (cellZ(ROOM.r0) + cellZ(ROOM.r1)) / 2;
	const panel = (name: string, dx: number, dz: number, degrees: number, runLength: number) => {
		const yaw = (degrees * Math.PI) / 180;
		const x = roomX + dx;
		const z = roomZ + dz;
		const id = `mirror-maze-room-${name}`;
		box(id, 'Mirror Wall', [x, HEIGHT / 2, z], [runLength, HEIGHT, THICKNESS], '#64748b', { yaw });
		plane(`${id}-a`, x, z, yaw + Math.PI, runLength - 0.1);
		plane(`${id}-b`, x, z, yaw, runLength - 0.1);
	};
	panel('30', -0.75, -0.2, 30, 1.3);
	panel('60', 0.85, 0.65, 60, 1.3);
	panel('45', 0.1, -1.15, 45, 1.3);
	box('mirror-maze-room-pillar', 'Glass Pillar', [roomX - 0.2, HEIGHT / 2, roomZ + 0.9], [0.5, HEIGHT, 0.5], GLASS, { opacity: 0.18 });

	// --- The start and the way out ---
	slots.push(
		createSlot({
			id: 'mirror-maze-start',
			name: 'Start Pad',
			position: [0, 0.015, START_Z],
			scale: [1.2, 0.03, 1.2],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#38bdf8' }]
		})
	);
	const exitX = cellX(exit);
	const gateZ = cellZ(ROWS - 1) + P / 2;
	box('mirror-maze-gate-left', 'Exit Gate', [exitX - P / 2 + 0.05, HEIGHT / 2, gateZ], [0.16, HEIGHT, 0.16], '#facc15');
	box('mirror-maze-gate-right', 'Exit Gate', [exitX + P / 2 - 0.05, HEIGHT / 2, gateZ], [0.16, HEIGHT, 0.16], '#facc15');
	slots.push(
		createSlot({
			id: 'mirror-maze-exit-pad',
			name: 'Exit Pad',
			position: [exitX, 0.015, gateZ + 2],
			scale: [1.6, 0.03, 1.6],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#facc15' }]
		}),
		createSlot({
			id: 'mirror-maze-exit-beacon',
			name: 'Exit Beacon',
			position: [exitX, 1.5, gateZ + 2],
			scale: [0.2, 3, 0.2],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#fde047' }, { type: 'pointLight', color: '#fde047', intensity: 0.8, range: 7 }]
		}),
		createSlot({
			id: 'mirror-maze-exit-sign',
			name: 'Exit Sign',
			position: [exitX, 2.5, gateZ + 3],
			components: [{ type: 'textDisplay', title: 'Exit', lines: ['You found the way out'], color: '#fef9c3', scale: 0.6 }]
		})
	);
	return slots;
}
