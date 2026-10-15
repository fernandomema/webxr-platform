import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { DIVIDERS, DOOR, HALL, ID, LOBBY, PARKED, PORCH, TUNING, UI } from './bistroData.ts';
import type { Vec3 } from './bistroData.ts';
import { ALONG_Z, COLOR, INK, MUTED, button, frame, group, loose, part, pieces, row, screen, sign, text, ui, yaw } from './bistroLook.ts';

const X0 = HALL.minX, X1 = HALL.minX + HALL.w, Z0 = HALL.minZ, Z1 = HALL.minZ + HALL.d, H = HALL.height;
const T = 0.3;
const MID_X = (X0 + X1) / 2, MID_Z = (Z0 + Z1) / 2;
/** How high the green panelling goes. */
const DADO = 1.05;
/** The width of one leaf of the door to the lobby, between its frames. */
export const LEAF = DOOR.half - 0.1;
/** How high the middle of the day board hangs. */
export const RAIL_Y = 2.6;

/** A lamp whose light is in the world's baked lighting: it is drawn live only where that is not in use. */
const lamp = (id: string, at: Vec3, color: string, intensity: number, range: number): Slot =>
	createSlot({ id, name: 'Light', position: at, components: [{ type: 'pointLight', color, intensity, range, baked: true }] });

/** Daylight through a window: a cone of cool light from the pane, down into the room. `into` is the way the room is from the window, as a yaw. */
function daylight(id: string, at: Vec3, into: number, intensity = 0.55): Slot {
	// Yaw towards the room, then tip the beam 35 degrees down.
	const tip = (35 * Math.PI) / 360;
	const [, y, , w] = yaw(into);
	const rotation: [number, number, number, number] = [w * Math.sin(tip), y * Math.cos(tip), -y * Math.sin(tip), w * Math.cos(tip)];
	return createSlot({ id, name: 'Daylight', position: at, rotation, components: [{ type: 'spotLight', color: '#eaf4ff', intensity, range: 8, angle: 120, exponent: 1.2, baked: true }] });
}

/**
 * A window in a wall: a pane of daylight in an oak frame with a cross of glazing bars, a sill, and a red café curtain over its lower
 * part. `at` is the middle of the pane on the wall's inner face, `into` the way the room is from it (a yaw), `width` its width.
 */
function windowIn(id: string, at: Vec3, into: number, width: number): Slot[] {
	const height = 1.35;
	const root = group(id, 'Window', at, { rotation: yaw(into) });
	// In the window's own space the room is along +z and the wall behind.
	return [
		root,
		...pieces(id, 'Window', [
			['pane', 'box', [0, 0, 0.012], [width, height, 0.02], COLOR.glassDay, { unlit: true }],
			['top', 'box', [0, height / 2 + 0.04, 0.04], [width + 0.16, 0.08, 0.1], COLOR.oak],
			['bottom', 'box', [0, -height / 2 - 0.04, 0.04], [width + 0.16, 0.08, 0.1], COLOR.oak],
			['left', 'box', [-width / 2 - 0.04, 0, 0.04], [0.08, height, 0.1], COLOR.oak],
			['right', 'box', [width / 2 + 0.04, 0, 0.04], [0.08, height, 0.1], COLOR.oak],
			['bar-v', 'box', [0, 0, 0.03], [0.04, height, 0.05], COLOR.oakDark],
			['bar-h', 'box', [0, 0.18, 0.03], [width, 0.04, 0.05], COLOR.oakDark],
			['sill', 'box', [0, -height / 2 - 0.1, 0.1], [width + 0.3, 0.05, 0.22], COLOR.oak],
			['rod', 'cylinder', [0, -0.1, 0.11], [0.02, width + 0.1, 0.02], COLOR.brass, { rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
			['curtain', 'box', [0, -0.39, 0.1], [width - 0.04, 0.56, 0.025], COLOR.red]
		]),
		daylight(`${id}-day`, [at[0] + Math.sin(into) * 0.25, at[1] + 0.3, at[2] + Math.cos(into) * 0.25], into)
	];
}

/** A lamp hanging over the dining room: a cord, a green enamel shade and a warm bulb. */
function pendant(id: string, x: number, z: number): Slot[] {
	const y = 2.3;
	return [
		part(`${id}-cord`, 'Lamp Cord', 'cylinder', [x, (y + 0.12 + H) / 2, z], [0.016, H - y - 0.12, 0.016], COLOR.iron),
		part(`${id}-shade`, 'Lamp Shade', 'cylinder', [x, y + 0.06, z], [0.42, 0.14, 0.42], COLOR.green),
		part(`${id}-cap`, 'Lamp Shade', 'cylinder', [x, y + 0.16, z], [0.2, 0.08, 0.2], COLOR.greenDark),
		part(`${id}-bulb`, 'Bulb', 'sphere', [x, y - 0.03, z], [0.13, 0.13, 0.13], COLOR.lampWarm, { unlit: true }),
		lamp(`${id}-light`, [x, y - 0.25, z], '#ffe0bd', 0.42, 4.6)
	];
}

/** A strip light over the kitchen: cool and bright, because that is where the work is seen. */
function strip(id: string, x: number, z: number): Slot[] {
	const y = H - 0.5;
	return [
		part(`${id}-rod-a`, 'Light Rod', 'cylinder', [x - 0.45, (y + H) / 2, z], [0.014, H - y, 0.014], COLOR.steelDark),
		part(`${id}-rod-b`, 'Light Rod', 'cylinder', [x + 0.45, (y + H) / 2, z], [0.014, H - y, 0.014], COLOR.steelDark),
		part(`${id}-body`, 'Strip Light', 'box', [x, y, z], [1.3, 0.07, 0.2], COLOR.steel),
		part(`${id}-tube`, 'Light Tube', 'box', [x, y - 0.045, z], [1.2, 0.03, 0.1], COLOR.lampCool, { unlit: true }),
		lamp(`${id}-light`, [x, y - 0.3, z], '#f2f6ff', 0.4, 5)
	];
}

/** The four walls, the floor and the ceiling of the hall, the panelling, and the wall it shares with the lobby. */
function shell(): Slot[] {
	const wall = (id: string, name: string, at: Vec3, scale: Vec3) => part(id, name, 'box', at, scale, COLOR.plaster, { solid: true, material: 'plaster' });
	const dado = (id: string, at: Vec3, scale: Vec3) => part(`bi-h-dado-${id}`, 'Panelling', 'box', at, scale, COLOR.green);
	const cap = (id: string, at: Vec3, scale: Vec3) => part(`bi-h-cap-${id}`, 'Dado Rail', 'box', at, scale, COLOR.oak);
	const rail = (id: string, at: Vec3, scale: Vec3) => part(`bi-h-rail-${id}`, 'Picture Rail', 'box', at, scale, COLOR.brass);
	const half = DOOR.half;
	const sideWidth = X1 + T - half; // from the door to the outside of a side wall
	const sharedTop = 3.7;
	const slots: Slot[] = [
		part('bi-h-floor', 'Hall Floor', 'ground', [MID_X, 0, MID_Z], [HALL.w / 20, 1, HALL.d / 20], COLOR.oak, { solid: true, material: 'parquet' }),
		part('bi-h-ceiling', 'Hall Ceiling', 'box', [MID_X, H + 0.1, MID_Z], [HALL.w + 2 * T, 0.2, HALL.d + 2 * T], COLOR.cream),
		wall('bi-h-wall-w', 'West Wall', [X0 - T / 2, H / 2, MID_Z], [T, H, HALL.d + 2 * T]),
		wall('bi-h-wall-e', 'East Wall', [X1 + T / 2, H / 2, MID_Z], [T, H, HALL.d + 2 * T]),
		wall('bi-h-wall-nl', 'North Wall', [-(half + sideWidth / 2), H / 2, Z1 + T / 2], [sideWidth, H, T]),
		wall('bi-h-wall-nr', 'North Wall', [half + sideWidth / 2, H / 2, Z1 + T / 2], [sideWidth, H, T]),
		wall('bi-h-wall-nt', 'North Wall', [0, (DOOR.height + H) / 2, Z1 + T / 2], [2 * half, H - DOOR.height, T]),
		// The wall between the hall and the lobby is thick, and tall enough for both rooms.
		wall('bi-h-wall-sl', 'Kitchen Wall', [-(half + (LOBBY.maxX + T - half) / 2), sharedTop / 2, (LOBBY.maxZ + Z0) / 2], [LOBBY.maxX + T - half, sharedTop, Z0 - LOBBY.maxZ]),
		wall('bi-h-wall-sr', 'Kitchen Wall', [half + (LOBBY.maxX + T - half) / 2, sharedTop / 2, (LOBBY.maxZ + Z0) / 2], [LOBBY.maxX + T - half, sharedTop, Z0 - LOBBY.maxZ]),
		wall('bi-h-wall-st', 'Kitchen Wall', [0, (DOOR.height + sharedTop) / 2, (LOBBY.maxZ + Z0) / 2], [2 * half, sharedTop - DOOR.height, Z0 - LOBBY.maxZ]),
		// Panelling to waist height, a rail on top of it, and a brass picture rail up the wall.
		dado('w', [X0 + 0.025, DADO / 2, MID_Z], [0.05, DADO, HALL.d]),
		dado('e', [X1 - 0.025, DADO / 2, MID_Z], [0.05, DADO, HALL.d]),
		dado('nl', [-(half + 0.1 + (X1 - half - 0.1) / 2), DADO / 2, Z1 - 0.025], [X1 - half - 0.1, DADO, 0.05]),
		dado('nr', [half + 0.1 + (X1 - half - 0.1) / 2, DADO / 2, Z1 - 0.025], [X1 - half - 0.1, DADO, 0.05]),
		dado('sl', [-(half + 0.1 + (X1 - half - 0.1) / 2), DADO / 2, Z0 + 0.025], [X1 - half - 0.1, DADO, 0.05]),
		dado('sr', [half + 0.1 + (X1 - half - 0.1) / 2, DADO / 2, Z0 + 0.025], [X1 - half - 0.1, DADO, 0.05]),
		cap('w', [X0 + 0.04, DADO + 0.025, MID_Z], [0.08, 0.05, HALL.d]),
		cap('e', [X1 - 0.04, DADO + 0.025, MID_Z], [0.08, 0.05, HALL.d]),
		cap('nl', [-(half + 0.1 + (X1 - half - 0.1) / 2), DADO + 0.025, Z1 - 0.04], [X1 - half - 0.1, 0.05, 0.08]),
		cap('nr', [half + 0.1 + (X1 - half - 0.1) / 2, DADO + 0.025, Z1 - 0.04], [X1 - half - 0.1, 0.05, 0.08]),
		cap('sl', [-(half + 0.1 + (X1 - half - 0.1) / 2), DADO + 0.025, Z0 + 0.04], [X1 - half - 0.1, 0.05, 0.08]),
		cap('sr', [half + 0.1 + (X1 - half - 0.1) / 2, DADO + 0.025, Z0 + 0.04], [X1 - half - 0.1, 0.05, 0.08]),
		rail('w', [X0 + 0.02, 2.82, MID_Z], [0.04, 0.04, HALL.d]),
		rail('e', [X1 - 0.02, 2.82, MID_Z], [0.04, 0.04, HALL.d]),
		rail('n', [MID_X, 2.82, Z1 - 0.02], [HALL.w, 0.04, 0.04]),
		rail('s', [MID_X, 2.82, Z0 + 0.02], [HALL.w, 0.04, 0.04])
	];
	// Beams across the ceiling.
	for (const z of [2, 4, 6]) slots.push(part(`bi-h-beam-${z}`, 'Ceiling Beam', 'box', [MID_X, H - 0.11, z], [HALL.w, 0.22, 0.24], COLOR.walnut));
	return slots;
}

/** The two doorways: the oak frames, the mat, the bell and the sign that says whether the restaurant is open. */
function doorways(): Slot[] {
	const half = DOOR.half;
	const jamb = (id: string, x: number, z: number, depth: number) => part(id, 'Door Frame', 'box', [x, DOOR.height / 2, z], [0.1, DOOR.height, depth], COLOR.oak, { solid: true });
	const zNorth = Z1 + T / 2, zSouth = (LOBBY.maxZ + Z0) / 2;
	return [
		// The frames wrap the ends of the walls, so that no two faces lie in the same plane.
		jamb('bi-h-jamb-nl', -half + 0.03, zNorth, T + 0.1),
		jamb('bi-h-jamb-nr', half - 0.03, zNorth, T + 0.1),
		part('bi-h-head-n', 'Door Frame', 'box', [0, DOOR.height - 0.03, zNorth], [2 * half + 0.04, 0.1, T + 0.1], COLOR.oak),
		jamb('bi-h-jamb-sl', -half + 0.03, zSouth, Z0 - LOBBY.maxZ + 0.16),
		jamb('bi-h-jamb-sr', half - 0.03, zSouth, Z0 - LOBBY.maxZ + 0.16),
		part('bi-h-head-s', 'Door Frame', 'box', [0, DOOR.height - 0.03, zSouth], [2 * half + 0.04, 0.1, Z0 - LOBBY.maxZ + 0.16], COLOR.oak),
		// The walls are thick: each doorway has its own piece of floor, or a player would fall between the rooms.
		part('bi-h-sill-s', 'Threshold', 'ground', [0, 0, zSouth], [(2 * half) / 20, 1, (Z0 - LOBBY.maxZ) / 20], COLOR.oakDark, { solid: true }),
		part('bi-h-sill-n', 'Threshold', 'ground', [0, 0, zNorth], [(2 * half) / 20, 1, T / 20], COLOR.oakDark, { solid: true }),
		part('bi-h-mat', 'Door Mat', 'box', [0, 0.008, Z1 - 0.5], [1.5, 0.016, 0.8], COLOR.red),
		part('bi-h-mat-edge', 'Door Mat', 'box', [0, 0.012, Z1 - 0.5], [1.3, 0.016, 0.6], '#8f1d17'),
		part('bi-h-bell-arm', 'Door Bell', 'box', [0.55, DOOR.height + 0.2, Z1 - 0.1], [0.03, 0.03, 0.2], COLOR.brass),
		part('bi-h-bell', 'Door Bell', 'sphere', [0.55, DOOR.height + 0.13, Z1 - 0.19], [0.1, 0.1, 0.1], COLOR.brass),
		// It hangs over the street door and is read from inside the hall.
		sign(ID.openSign, [0, DOOR.height + 0.52, Z1 - 0.03], Math.PI, 1.3, 0.42, 'CLOSED', [], 1.5, '#7f1d1d'),
		...frame('bi-h-open-frame', [0, DOOR.height + 0.52, Z1 - 0.03], 'x', 1.3, 0.42, COLOR.oakDark),
		// A clock over the door to the lobby.
		part('bi-h-clock', 'Clock', 'cylinder', [0, 2.85, Z0 + 0.04], [0.5, 0.05, 0.5], COLOR.walnut, { rotation: ALONG_Z }),
		part('bi-h-clock-face', 'Clock', 'cylinder', [0, 2.85, Z0 + 0.065], [0.42, 0.01, 0.42], COLOR.paper, { rotation: ALONG_Z }),
		part('bi-h-clock-hour', 'Clock', 'box', [0.04, 2.9, Z0 + 0.075], [0.03, 0.13, 0.01], COLOR.ink, { rotation: [0, 0, -0.3826834, 0.9238795] }),
		part('bi-h-clock-minute', 'Clock', 'box', [0, 2.93, Z0 + 0.075], [0.02, 0.17, 0.01], COLOR.ink)
	];
}

/** The porch the guests wait in before they come through the street door: paving, plain walls and the doors to the street, full of day. */
function porch(): Slot[] {
	const { minX, maxX, minZ, maxZ, height } = PORCH;
	const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2, width = maxX - minX, depth = maxZ - minZ;
	const wall = (id: string, at: Vec3, scale: Vec3) => part(id, 'Porch Wall', 'box', at, scale, COLOR.plaster, { solid: true, material: 'plaster' });
	return [
		part('bi-p-floor', 'Porch Floor', 'ground', [midX, 0, midZ], [width / 20, 1, depth / 20], COLOR.steelDark, { solid: true, material: 'paving' }),
		part('bi-p-ceiling', 'Porch Ceiling', 'box', [midX, height + 0.1, midZ], [width + 2 * T, 0.2, depth + T], COLOR.cream),
		wall('bi-p-wall-w', [minX - T / 2, height / 2, midZ], [T, height, depth + T]),
		wall('bi-p-wall-e', [maxX + T / 2, height / 2, midZ], [T, height, depth + T]),
		wall('bi-p-wall-n', [midX, height / 2, maxZ + T / 2], [width + 2 * T, height, T]),
		// The doors to the street: glass full of daylight.
		...loose('bi-p', 'Street Door', [
			['glass-l', 'box', [-0.5, 1.15, maxZ - 0.012], [0.9, 2.1, 0.02], COLOR.glassDay, { unlit: true }],
			['glass-r', 'box', [0.5, 1.15, maxZ - 0.012], [0.9, 2.1, 0.02], COLOR.glassDay, { unlit: true }],
			['door-top', 'box', [0, 2.26, maxZ - 0.05], [2.1, 0.12, 0.1], COLOR.green],
			['door-mid', 'box', [0, 1.15, maxZ - 0.05], [0.1, 2.1, 0.1], COLOR.green],
			['door-l', 'box', [-1.0, 1.15, maxZ - 0.05], [0.1, 2.3, 0.1], COLOR.green],
			['door-r', 'box', [1.0, 1.15, maxZ - 0.05], [0.1, 2.3, 0.1], COLOR.green],
			['door-kick', 'box', [0, 0.14, maxZ - 0.04], [1.9, 0.28, 0.06], COLOR.greenDark],
			['handle-l', 'box', [-0.12, 1.1, maxZ - 0.1], [0.03, 0.3, 0.03], COLOR.brass],
			['handle-r', 'box', [0.12, 1.1, maxZ - 0.1], [0.03, 0.3, 0.03], COLOR.brass],
			['side-l', 'box', [-1.65, 1.5, maxZ - 0.012], [0.7, 1.3, 0.02], COLOR.glassDay, { unlit: true }],
			['side-r', 'box', [1.65, 1.5, maxZ - 0.012], [0.7, 1.3, 0.02], COLOR.glassDay, { unlit: true }]
		]),
		lamp('bi-p-light', [0, height - 0.5, midZ], '#eef6ff', 0.8, 5),
		daylight('bi-p-day', [0, 2.0, maxZ - 0.3], Math.PI, 0.7),
		// A bench and a plant, so that it is a place and not a corridor.
		...loose('bi-p-bench', 'Bench', [
			['seat', 'box', [-1.65, 0.45, minZ + 0.9], [0.5, 0.06, 1.3], COLOR.oak],
			['leg-a', 'box', [-1.65, 0.21, minZ + 0.35], [0.44, 0.42, 0.06], COLOR.oakDark],
			['leg-b', 'box', [-1.65, 0.21, minZ + 1.45], [0.44, 0.42, 0.06], COLOR.oakDark]
		]),
		...loose('bi-p-plant', 'Plant', [
			['pot', 'cylinder', [1.75, 0.25, minZ + 0.45], [0.42, 0.5, 0.42], COLOR.terracotta],
			['leaves-a', 'sphere', [1.75, 0.82, minZ + 0.45], [0.62, 0.66, 0.62], COLOR.leaf],
			['leaves-b', 'sphere', [1.62, 1.12, minZ + 0.52], [0.4, 0.42, 0.4], COLOR.leafLight]
		])
	];
}

/** Windows and lamps: where the light of the hall comes from. */
function lighting(): Slot[] {
	const slots: Slot[] = [];
	const y = 1.9;
	// North wall: a wide window on each side of the door, and a narrow one beyond it for the bigger halls.
	for (const [x, width] of [[-2.0, 1.5], [2.0, 1.5], [-3.7, 0.8], [3.7, 0.8]] as const) slots.push(...windowIn(`bi-h-win-n${x}`, [x, y, Z1], Math.PI, width));
	// East and west walls: seen only in the grand hall.
	for (const z of [2.6, 5.6]) {
		slots.push(...windowIn(`bi-h-win-w${z}`, [X0, y, z], Math.PI / 2, 1.5));
		slots.push(...windowIn(`bi-h-win-e${z}`, [X1, y, z], -Math.PI / 2, 1.5));
	}
	for (const x of [-4, -2, 2, 4]) {
		slots.push(...pendant(`bi-h-pend-${x}-a`, x, 4.6), ...pendant(`bi-h-pend-${x}-b`, x, 6.5));
		slots.push(...strip(`bi-h-strip-${x}`, x, 1.6));
	}
	slots.push(...pendant('bi-h-pend-0', 0, 5.5));
	slots.push(...strip('bi-h-strip-0', 0, 0.9));
	return slots;
}

/**
 * What the script moves: the tiles of the kitchen floor, the half walls between the kitchen and the dining room, the hoardings
 * that close off the part of the hall a restaurant does not use, the leaves of the door to the lobby, and the rail the day board
 * hangs from. They wait out of sight (the door apart, which starts shut) until a restaurant opens.
 */
function movingParts(): Slot[] {
	const slots: Slot[] = [part(ID.tiles, 'Kitchen Tiles', 'ground', PARKED, [0.3, 1, 0.15], COLOR.white, { solid: true, material: 'tiles' })];
	for (let n = 0; n < DIVIDERS; n++) {
		const id = ID.divider(n);
		slots.push(
			group(id, 'Half Wall', PARKED),
			...pieces(id, 'Half Wall', [
				['wall', 'box', [0, 0.5, 0], [1.0, 1.0, 0.14], COLOR.green, { solid: true }],
				['panel', 'box', [0, 0.52, 0], [0.8, 0.66, 0.17], COLOR.greenDark],
				['cap', 'box', [0, 1.025, 0], [1.02, 0.05, 0.24], COLOR.oak]
			])
		);
	}
	for (const side of ['w', 'e'] as const) {
		const id = ID.partition(side);
		// Built for the west side: the hall is along +x from it. The east one is the same, turned round.
		slots.push(
			group(id, 'Hoarding', PARKED, { rotation: yaw(side === 'w' ? 0 : Math.PI) }),
			...pieces(id, 'Hoarding', [
				['wall', 'box', [-0.1, H / 2, 0], [0.2, H, HALL.d], '#c9a36b', { solid: true }],
				['stripe', 'box', [0.005, 1.2, 0], [0.02, 0.16, HALL.d], COLOR.gold],
				['stripe-low', 'box', [0.005, 0.12, 0], [0.02, 0.24, HALL.d], COLOR.iron],
				['batten-a', 'box', [0.01, H / 2, -2.6], [0.04, H, 0.1], '#a9834f'],
				['batten-b', 'box', [0.01, H / 2, 0], [0.04, H, 0.1], '#a9834f'],
				['batten-c', 'box', [0.01, H / 2, 2.6], [0.04, H, 0.1], '#a9834f']
			]),
			sign(`${id}-sign`, [0.03, 1.95, -1.3], Math.PI / 2, 1.9, 0.9, 'MORE ROOM SOON', ['A bigger hall opens', 'as your chef level grows'], 1.25, '#3f2d14', id),
			sign(`${id}-sign-b`, [0.03, 1.95, 1.3], Math.PI / 2, 1.9, 0.9, 'WORK IN PROGRESS', ['Mind the paint'], 1.25, '#3f2d14', id)
		);
	}
	// The door to the lobby: two swing leaves with a round window each. Shut until a restaurant is opened.
	const zDoor = (LOBBY.maxZ + Z0) / 2;
	for (const side of ['l', 'r'] as const) {
		const id = ID.doorLeaf(side);
		const x = side === 'l' ? -LEAF / 2 : LEAF / 2;
		slots.push(
			group(id, 'Kitchen Door', [x, 0, zDoor]),
			...pieces(id, 'Kitchen Door', [
				['leaf', 'box', [0, 1.1, 0], [LEAF - 0.02, 2.2, 0.06], COLOR.green, { solid: true }],
				['kick', 'box', [0, 0.22, 0], [LEAF - 0.02, 0.4, 0.075], COLOR.steel],
				['push', 'box', [0, 1.15, 0], [0.26, 0.4, 0.075], COLOR.brass],
				['window', 'cylinder', [0, 1.72, 0], [0.4, 0.08, 0.4], COLOR.glassDay, { rotation: ALONG_Z }],
				['window-ring', 'cylinder', [0, 1.72, 0], [0.48, 0.07, 0.48], COLOR.brass, { rotation: ALONG_Z }]
			])
		);
	}
	// The rail over the pass, with the day board on it and a lamp for every heart.
	slots.push(
		group(ID.rail, 'Order Rail', PARKED),
		...pieces(ID.rail, 'Order Rail', [
			['rod-a', 'cylinder', [-1.25, (0.4 + H - RAIL_Y) / 2, 0], [0.02, H - RAIL_Y - 0.4, 0.02], COLOR.iron],
			['rod-b', 'cylinder', [1.25, (0.4 + H - RAIL_Y) / 2, 0], [0.02, H - RAIL_Y - 0.4, 0.02], COLOR.iron],
			['beam', 'box', [0, 0.36, 0], [2.9, 0.08, 0.1], COLOR.walnut],
			['back', 'box', [0, 0, 0.03], [2.76, 0.66, 0.04], COLOR.walnut]
		])
	);
	for (let n = 0; n < TUNING.hearts; n++) slots.push(part(ID.heart(n), 'Heart', 'sphere', [-0.22 + n * 0.22, 0.47, 0], [0.15, 0.15, 0.1], COLOR.red, { parentId: ID.rail }));
	return slots;
}

/** The day board on the rail, and the two screens of the kitchen: the service console and the blueprint shop. */
function screens(): Slot[] {
	const slots: Slot[] = [];
	// Read from the kitchen, which is south of the rail.
	slots.push(screen(UI.hud, ID.rail, 'Day Board', [0, 0, 0], Math.PI, 1040, 240, 2.7));
	slots.push(
		text(UI.hudTitle, UI.hud, 'BISTRO RUSH', 1000, 70, 46, COLOR.gold, 'center', true),
		text(UI.hudStats, UI.hud, '', 1000, 50, 30, INK, 'center', true),
		text(UI.hudOrders, UI.hud, '', 1000, 100, 26, MUTED, 'center')
	);

	const y = 1.62;
	// On the wall the hall shares with the lobby, each side of the door: read from the north.
	slots.push(screen(UI.service, ID.root, 'Service Console', [2.0, y, Z0 + 0.075], 0, 620, 620, 1.3), ...frame('bi-svc-frame', [2.0, y, Z0 + 0.05], 'x', 1.3, 1.3));
	slots.push(
		text(UI.serviceTitle, UI.service, 'SERVICE', 580, 60, 40, COLOR.gold, 'center', true),
		text(UI.serviceMessage, UI.service, '', 580, 330, 24, INK, 'center', true),
		button(UI.open, UI.service, 'OPEN FOR BUSINESS', 560, 86, '#15803d', 32),
		ui('bi-svc-gap', UI.service, 'container', { width: 560, height: 14 }),
		button(UI.close, UI.service, 'SAVE AND CLOSE', 560, 64, '#57534e', 24)
	);

	slots.push(screen(UI.shop, ID.root, 'Blueprint Shop', [-2.0, y, Z0 + 0.075], 0, 700, 660, 1.4), ...frame('bi-shop-frame', [-2.0, y, Z0 + 0.05], 'x', 1.4, 1.32));
	slots.push(text(UI.shopTitle, UI.shop, 'BLUEPRINTS', 660, 58, 40, COLOR.gold, 'center', true), text(UI.shopCoins, UI.shop, '', 660, 40, 26, '#fde68a', 'center', true));
	for (let i = 0; i < TUNING.offers; i++) {
		slots.push(
			row(UI.shopRow(i), UI.shop, 660, 96, 10, { margin: 3 }),
			text(UI.shopName(i), UI.shopRow(i), '', 440, 92, 22, INK, 'left', true),
			button(UI.shopBuy(i), UI.shopRow(i), '', 200, 84, '#15803d', 26)
		);
	}
	slots.push(row('bi-shop-foot', UI.shop, 660, 70, 10, { margin: 3 }), text(UI.shopNote, 'bi-shop-foot', '', 440, 66, 19, MUTED, 'left'), button(UI.reroll, 'bi-shop-foot', 'REROLL', 200, 62, '#b45309', 22));
	return slots;
}

/** The hall of the restaurant: everything that is always there. What a restaurant puts in it is in bistroProps.ts. */
export function buildHall(): Slot[] {
	return [...shell(), ...doorways(), ...porch(), ...lighting(), ...movingParts(), ...screens()];
}
