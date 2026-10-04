import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { box, cylinder, group, sphere } from './beatTurntableParts.ts';

/**
 * The look of the Archive Jukebox world: a record library for the Internet Archive's audio collection (the signs credit archive.org). Walls of dark wood, shelves of record spines along both sides, a
 * card catalogue and a big sign behind the panel, a rug and warm hanging lamps. All of it is static scenery; the only moving
 * parts (the record, the tonearm and the lamp of the player) belong to the player in archiveJukebox.ts.
 */

const WOOD = '#4a3224';
const WOOD_DARK = '#2b1d14';
const BRASS = '#d4a017';
const ROOM = { halfWidth: 5, back: -2.5, front: 8.2, height: 3.6 } as const;

/** Colours of the record spines. */
const SPINES = ['#9f1239', '#0f766e', '#1d4ed8', '#a16207', '#7e22ce', '#be185d', '#047857', '#c2410c', '#e5e7eb', '#334155', '#facc15'];

/** A small deterministic generator: the same shelves every time the world loads. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

const LEFT_FACING: [number, number, number, number] = [0, -0.7071, 0, 0.7071];
const RIGHT_FACING: [number, number, number, number] = [0, 0.7071, 0, 0.7071];

/** A framed sign on a wall: `facing` says which way it looks (the plane's front is its -Z side). */
export function sign(id: string, name: string, position: [number, number, number], facing: 'back' | 'left' | 'right', width: number, height: number, title: string, lines: string[]): Slot[] {
	const side = facing !== 'back';
	const out = facing === 'left' ? 0.03 : facing === 'right' ? -0.03 : 0;
	return [
		box(`${id}-board`, `${name} Frame`, position, side ? [0.05, height + 0.1, width + 0.1] : [width + 0.1, height + 0.1, 0.05], BRASS),
		createSlot({
			id,
			name,
			position: [position[0] + out, position[1], position[2] - (side ? 0 : 0.03)],
			rotation: facing === 'left' ? LEFT_FACING : facing === 'right' ? RIGHT_FACING : [0, 0, 0, 1],
			scale: [width, height, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: WOOD_DARK },
				{ type: 'textDisplay', title, lines, color: WOOD_DARK, verticalAlign: 'middle' }
			]
		})
	];
}

function buildShell(): Slot[] {
	const { halfWidth: w, back, front, height } = ROOM;
	const depth = front - back;
	const mid = (front + back) / 2;
	const slots: Slot[] = [
		box('aj-wall-back', 'Back Wall', [0, height / 2, back], [w * 2, height, 0.2], '#3a2a20', {}, true),
		box('aj-wall-front', 'Front Wall', [0, height / 2, front], [w * 2, height, 0.2], '#3a2a20', {}, true),
		box('aj-wall-left', 'Left Wall', [-w, height / 2, mid], [0.2, height, depth], '#3a2a20', {}, true),
		box('aj-wall-right', 'Right Wall', [w, height / 2, mid], [0.2, height, depth], '#3a2a20', {}, true),
		box('aj-ceiling', 'Ceiling', [0, height + 0.05, mid], [w * 2 + 0.4, 0.1, depth + 0.4], '#1c1410')
	];
	// Panelling: a dark wainscot with a brass rail along the foot of every wall.
	const lining: [string, [number, number, number], [number, number, number]][] = [
		['back', [0, 0.5, back + 0.12], [w * 2, 1, 0.05]],
		['front', [0, 0.5, front - 0.12], [w * 2, 1, 0.05]],
		['left', [-w + 0.12, 0.5, mid], [0.05, 1, depth]],
		['right', [w - 0.12, 0.5, mid], [0.05, 1, depth]]
	];
	for (const [side, position, scale] of lining) {
		slots.push(box(`aj-wainscot-${side}`, 'Wainscot', position, scale, WOOD_DARK));
		const rail: [number, number, number] = [position[0] * 1, 1.02, position[2] * 1];
		slots.push(box(`aj-rail-${side}`, 'Brass Rail', rail, [scale[0] === 0.05 ? 0.07 : scale[0], 0.03, scale[2] === 0.05 ? 0.07 : scale[2]], BRASS));
	}
	// Ceiling beams across the room.
	for (let index = 0; index < 5; index++) {
		slots.push(box(`aj-beam-${index}`, 'Ceiling Beam', [0, height - 0.1, back + 1 + index * 2.4], [w * 2, 0.2, 0.22], WOOD_DARK));
	}
	// Floor boards and the rug under the table.
	for (let index = 0; index < 13; index++) {
		slots.push(box(`aj-plank-${index}`, 'Floor Board Line', [-4.2 + index * 0.7, 0.004, mid], [0.012, 0.004, depth - 0.4], '#1a110b'));
	}
	slots.push(
		box('aj-rug', 'Rug', [0, 0.008, 3.6], [4.4, 0.012, 3.6], '#6b1d2a'),
		box('aj-rug-border', 'Rug Border', [0, 0.01, 3.6], [4.1, 0.012, 3.3], BRASS),
		box('aj-rug-field', 'Rug Field', [0, 0.012, 3.6], [3.9, 0.012, 3.1], '#4a1420')
	);
	return slots;
}

/** One shelving unit against a side wall: rows of record spines and, on top, archive boxes. */
function buildShelves(side: 'left' | 'right', index: number, z: number): Slot[] {
	const x = side === 'left' ? -ROOM.halfWidth + 0.3 : ROOM.halfWidth - 0.3;
	const toRoom = side === 'left' ? 1 : -1;
	const id = `aj-shelf-${side}-${index}`;
	const width = 1.5;
	const rows = [0.42, 1.0, 1.58];
	const next = random(side === 'left' ? 11 + index * 7 : 97 + index * 13);
	const slots: Slot[] = [
		box(`${id}-back`, 'Shelf Back', [x - toRoom * 0.16, 1.2, z], [0.03, 2.5, width + 0.08], WOOD_DARK),
		box(`${id}-side-0`, 'Shelf Side', [x, 1.2, z - width / 2 - 0.02], [0.34, 2.5, 0.04], WOOD, {}, true),
		box(`${id}-side-1`, 'Shelf Side', [x, 1.2, z + width / 2 + 0.02], [0.34, 2.5, 0.04], WOOD, {}, true),
		box(`${id}-top`, 'Shelf Top', [x, 2.47, z], [0.36, 0.05, width + 0.12], WOOD)
	];
	for (let row = 0; row < rows.length; row++) {
		const floor = rows[row] - 0.17;
		slots.push(box(`${id}-board-${row}`, 'Shelf Board', [x, floor, z], [0.34, 0.04, width], WOOD));
		let cursor = z - width / 2 + 0.03;
		let spine = 0;
		while (cursor < z + width / 2 - 0.1) {
			const thickness = 0.06 + next() * 0.06;
			const tall = 0.27 + next() * 0.05;
			slots.push(box(`${id}-spine-${row}-${spine}`, 'Record Spine', [x, floor + 0.02 + tall / 2, cursor + thickness / 2], [0.3, tall, thickness * 0.9], SPINES[Math.floor(next() * SPINES.length)]));
			cursor += thickness;
			spine += 1;
		}
	}
	// The top row: four archive boxes, each with a brass label.
	const topBoard = 2.1;
	slots.push(box(`${id}-board-top`, 'Shelf Board', [x, topBoard - 0.02, z], [0.34, 0.04, width], WOOD));
	for (let boxIndex = 0; boxIndex < 4; boxIndex++) {
		const bz = z - width / 2 + 0.2 + boxIndex * 0.37;
		slots.push(
			box(`${id}-archive-${boxIndex}`, 'Archive Box', [x, topBoard + 0.17, bz], [0.3, 0.34, 0.33], ['#7c5c3e', '#6b4f36', '#8a6a48', '#5f4631'][boxIndex]),
			box(`${id}-archive-label-${boxIndex}`, 'Archive Box Label', [x + toRoom * 0.153, topBoard + 0.17, bz], [0.006, 0.1, 0.2], '#f5e6c4')
		);
	}
	return slots;
}

/** The wall behind the panel: the big sign, a card catalogue on each side, and framed covers. */
function buildBackWall(): Slot[] {
	const wall = ROOM.front - 0.2;
	const slots: Slot[] = [
		...sign('aj-sign', 'Archive Sign', [0, 3.0, wall], 'back', 3.4, 0.5, 'INTERNET ARCHIVE', ['Audio collection - archive.org']),
		...sign('aj-credits', 'Credits Sign', [0, 2.66, wall], 'back', 3.4, 0.14, 'Music, covers and metadata courtesy of archive.org', ['Recordings belong to their uploaders and rights holders']),
		...sign('aj-sign-shelf-left', 'Shelf Sign', [-ROOM.halfWidth + 0.15, 2.85, 3.0], 'left', 1.2, 0.2, 'Classics', ['Shelf A']),
		...sign('aj-sign-shelf-right', 'Shelf Sign', [ROOM.halfWidth - 0.15, 2.85, 3.0], 'right', 1.2, 0.2, 'Folk and Jazz', ['Shelf B'])
	];
	// A card catalogue: a cabinet of small drawers with brass pulls, on each side of the panel.
	for (const side of [-1, 1]) {
		const id = `aj-catalog-${side < 0 ? 'left' : 'right'}`;
		const x = side * 2.9;
		slots.push(box(`${id}-body`, 'Card Catalogue', [x, 0.85, wall - 0.25], [1.5, 1.7, 0.5], WOOD, {}, true));
		for (let row = 0; row < 6; row++) {
			for (let col = 0; col < 4; col++) {
				const dx = x + (col - 1.5) * 0.35;
				const dy = 0.2 + row * 0.27;
				slots.push(
					box(`${id}-drawer-${row}-${col}`, 'Catalogue Drawer', [dx, dy + 0.05, wall - 0.51], [0.32, 0.24, 0.02], WOOD_DARK),
					box(`${id}-pull-${row}-${col}`, 'Brass Pull', [dx, dy + 0.05, wall - 0.53], [0.08, 0.015, 0.015], BRASS),
					box(`${id}-card-${row}-${col}`, 'Index Card', [dx, dy + 0.12, wall - 0.525], [0.06, 0.04, 0.004], '#f5e6c4')
				);
			}
		}
		slots.push(box(`${id}-top`, 'Catalogue Top', [x, 1.72, wall - 0.25], [1.56, 0.04, 0.56], WOOD_DARK));
	}
	// Framed sleeves on the wall above each catalogue.
	const frames = ['#9f1239', '#0f766e', '#1d4ed8', '#a16207', '#7e22ce', '#be185d'];
	frames.forEach((color, index) => {
		const x = (index < 3 ? -1 : 1) * (2.3 + (index % 3) * 0.6);
		slots.push(
			box(`aj-frame-${index}`, 'Sleeve Frame', [x, 2.3, wall - 0.03], [0.5, 0.5, 0.04], BRASS),
			box(`aj-frame-art-${index}`, 'Sleeve Art', [x, 2.3, wall - 0.06], [0.44, 0.44, 0.02], color),
			cylinder(`aj-frame-disc-${index}`, 'Sleeve Disc', [x, 2.3, wall - 0.075], 0.3, 0.01, '#0b0b10', { rotation: [0.7071, 0, 0, 0.7071] })
		);
	});
	return slots;
}

/** Warm pendant lamps along the room and a reading lamp on the table. */
function buildLamps(tableTop: number, tableZ: number): Slot[] {
	const slots: Slot[] = [];
	[0.4, 3.2, 6].forEach((z, index) => {
		const id = `aj-lamp-${index}`;
		slots.push(
			cylinder(`${id}-cord`, 'Lamp Cord', [0, ROOM.height - 0.45, z], 0.015, 0.9, '#111827'),
			cylinder(`${id}-shade`, 'Lamp Shade', [0, ROOM.height - 0.98, z], 0.5, 0.2, '#14532d'),
			sphere(`${id}-bulb`, 'Lamp Bulb', [0, ROOM.height - 1.1, z], 0.14, '#fde68a'),
			createSlot({ id: `${id}-light`, name: 'Lamp Light', position: [0, ROOM.height - 1.2, z], components: [{ type: 'pointLight', color: '#fcd34d', intensity: 0.7, range: 7 }] })
		);
	});
	slots.push(
		cylinder('aj-desk-lamp-base', 'Desk Lamp Base', [-0.9, tableTop + 0.01, tableZ + 0.25], 0.12, 0.02, '#111827'),
		cylinder('aj-desk-lamp-stem', 'Desk Lamp Stem', [-0.9, tableTop + 0.15, tableZ + 0.25], 0.015, 0.3, BRASS),
		cylinder('aj-desk-lamp-shade', 'Desk Lamp Shade', [-0.9, tableTop + 0.32, tableZ + 0.25], 0.15, 0.1, '#14532d'),
		createSlot({ id: 'aj-desk-lamp-light', name: 'Desk Lamp Light', position: [-0.9, tableTop + 0.25, tableZ + 0.25], components: [{ type: 'pointLight', color: '#fbbf24', intensity: 0.4, range: 3 }] })
	);
	return slots;
}

/** A small stand in a corner of the room with a few loose discs' sleeves to look at. */
function buildCorner(): Slot[] {
	const x = ROOM.halfWidth - 1.1;
	const z = ROOM.back + 1.2;
	return [
		group('aj-corner', 'Reading Corner', [x, 0, z]),
		cylinder('aj-corner-table', 'Reading Table', [x, 0.55, z], 0.9, 0.04, WOOD, { parentId: 'aj-corner' }),
		cylinder('aj-corner-leg', 'Reading Table Leg', [x, 0.28, z], 0.08, 0.55, '#1f2937', { parentId: 'aj-corner' }),
		cylinder('aj-corner-foot', 'Reading Table Foot', [x, 0.02, z], 0.5, 0.04, '#1f2937', { parentId: 'aj-corner' }),
		box('aj-corner-book-0', 'Book', [x - 0.1, 0.595, z], [0.22, 0.04, 0.3], '#9f1239', { parentId: 'aj-corner' }),
		box('aj-corner-book-1', 'Book', [x + 0.12, 0.595, z + 0.05], [0.2, 0.03, 0.28], '#1d4ed8', { parentId: 'aj-corner' })
	];
}

/** The whole room, minus the table, the player and the panel. */
export function buildArchiveDecor(tableTop: number, tableZ: number): Slot[] {
	const slots = [...buildShell(), ...buildBackWall(), ...buildLamps(tableTop, tableZ), ...buildCorner()];
	[0.6, 2.4, 4.2].forEach((z, index) => {
		slots.push(...buildShelves('left', index, z + 0.6), ...buildShelves('right', index, z + 0.6));
	});
	return slots;
}
