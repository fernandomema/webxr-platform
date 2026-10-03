import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { buildDisc } from './recordDisc.ts';
import { BEAT_TURNTABLE, BLUE, RED, box, cylinder, group } from './beatTurntableParts.ts';

/**
 * Where the player picks a song: a hi-fi stand with the turntable, a wall rack of records beside it and a stand for the
 * two sabers. The rack is made of sockets that take discs, so any record can be put back on a shelf (and a player's own
 * records can be brought here), and the turntable is one more socket: the world plays whatever sits on it.
 */
export const DECK = {
	/** The hi-fi stand: its top shelf is at `top`. */
	x: -1.5,
	z: 2.7,
	top: 0.8,
	/** The rack stands against the far left, its front facing +X, towards the stand. */
	rackX: -3,
	rackZ: 2.7,
	rackSlots: 4,
	rackRows: 2,
	rackSlotGap: 0.38,
	rackRowY: [0.67, 1.12],
	/** The saber stand is under the leaderboard: handles at `z` (towards the player), blades pointing at the stage. */
	sabers: { x: 1.9, z: 2.35, length: 1.2 },
	/** A rack socket's snap: the disc stands on its edge with its label towards +X, text upright. Euler degrees. */
	rackSnap: [90, 90, 0] as [number, number, number],
	/** The same rotation as a quaternion (what a disc already seated in the rack carries). */
	rackQuat: [0.5, 0.5, -0.5, 0.5] as [number, number, number, number]
} as const;

export const deckIds = {
	rackSocket: (row: number, slot: number) => `bt-rack-socket-${row}-${slot}`,
	armPivot: 'bt-arm-pivot',
	led: 'bt-led'
} as const;

const WOOD = '#4a3224';
const WOOD_DARK = '#2b1d14';
const METAL = '#9ca3af';

function buildStand(): Slot[] {
	const { x, z, top } = DECK;
	const legs = [[-0.44, -0.32], [0.44, -0.32], [-0.44, 0.32], [0.44, 0.32]].map(([dx, dz], index) => box(`bt-stand-leg-${index}`, 'Stand Leg', [x + dx, (top - 0.02) / 2, z + dz], [0.05, top - 0.02, 0.05], '#1f2937', {}, true));
	return [
		...legs,
		box('bt-stand-top', 'Stand Top Shelf', [x, top - 0.02, z], [1, 0.04, 0.76], WOOD, {}, true),
		box('bt-stand-low', 'Stand Low Shelf', [x, 0.3, z], [1, 0.03, 0.76], WOOD, {}, true),
		box('bt-amp', 'Amplifier', [x - 0.15, 0.4, z], [0.5, 0.14, 0.4], '#18181b'),
		box('bt-amp-face', 'Amplifier Face', [x - 0.15, 0.4, z - 0.205], [0.46, 0.1, 0.01], '#27272a'),
		cylinder('bt-amp-knob-0', 'Amplifier Knob', [x - 0.3, 0.4, z - 0.215], 0.05, 0.02, METAL, { rotation: [0.7071, 0, 0, 0.7071] }),
		cylinder('bt-amp-knob-1', 'Amplifier Knob', [x - 0.15, 0.4, z - 0.215], 0.05, 0.02, METAL, { rotation: [0.7071, 0, 0, 0.7071] }),
		box('bt-speaker', 'Speaker', [x + 0.28, 0.45, z], [0.24, 0.24, 0.3], '#111827', {}, true)
	];
}

function buildTurntable(): Slot[] {
	const { x, z, top } = DECK;
	const y = (above: number) => top + above;
	return [
		box('bt-plinth', 'Turntable Plinth', [x, y(0.04), z], [0.78, 0.08, 0.58], '#111827', {}, true),
		box('bt-plinth-trim', 'Turntable Trim', [x, y(0.081), z], [0.8, 0.004, 0.6], '#374151'),
		cylinder('bt-platter', 'Turntable Platter', [x, y(0.087), z], 0.36, 0.014, METAL),
		cylinder('bt-mat', 'Turntable Mat', [x, y(0.096), z], 0.33, 0.004, '#171717'),
		cylinder('bt-spindle', 'Spindle', [x, y(0.112), z], 0.008, 0.026, '#e5e7eb'),
		cylinder('bt-arm-base', 'Tonearm Base', [x + 0.27, y(0.1), z + 0.17], 0.06, 0.035, '#d4d4d8'),
		// The arm swings on its base: parked beside the platter, and over the record while a song plays.
		group(deckIds.armPivot, 'Tonearm Pivot', [x + 0.27, y(0.122), z + 0.17]),
		box('bt-arm', 'Tonearm', [0, 0, -0.14], [0.012, 0.012, 0.3], '#e5e7eb', { parentId: deckIds.armPivot }),
		box('bt-arm-head', 'Tonearm Head', [0, -0.004, -0.3], [0.024, 0.014, 0.04], '#27272a', { parentId: deckIds.armPivot }),
		box('bt-arm-weight', 'Tonearm Weight', [0, 0, 0.04], [0.034, 0.034, 0.034], '#a1a1aa', { parentId: deckIds.armPivot }),
		cylinder(deckIds.led, 'Status LED', [x - 0.3, y(0.085), z - 0.22], 0.02, 0.01, '#22c55e'),
		cylinder('bt-knob-0', 'Turntable Knob', [x - 0.3, y(0.085), z - 0.1], 0.045, 0.02, '#d4d4d8'),
		cylinder('bt-knob-1', 'Turntable Knob', [x - 0.3, y(0.085), z], 0.045, 0.02, '#d4d4d8'),
		// The socket is what makes it a turntable: the disc sits at its origin, on the mat. The world plays the song itself
		// (on a clock it can read), so the disc must not also play on its own.
		createSlot({
			id: BEAT_TURNTABLE.socketId,
			name: 'Turntable Socket',
			position: [x, y(0.107), z],
			components: [{ type: 'socket', accepts: ['disc'], radius: 0.25, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }]
		})
	];
}

/** The wall rack: two shelves of four slots, each slot a socket, with two records seated to begin with. */
function buildRack(): Slot[] {
	const { rackX: x, rackZ: z, rackSlots, rackSlotGap, rackRowY } = DECK;
	const span = rackSlots * rackSlotGap + 0.08;
	const slotZ = (slot: number) => z + (slot - (rackSlots - 1) / 2) * rackSlotGap;
	const slots: Slot[] = [
		box('bt-rack-back', 'Rack Back', [x - 0.13, 0.85, z], [0.04, 1.5, span + 0.1], WOOD_DARK, {}, true),
		box('bt-rack-side-0', 'Rack Side', [x, 0.85, z - span / 2 - 0.025], [0.3, 1.5, 0.05], WOOD, {}, true),
		box('bt-rack-side-1', 'Rack Side', [x, 0.85, z + span / 2 + 0.025], [0.3, 1.5, 0.05], WOOD, {}, true),
		box('bt-rack-top', 'Rack Top', [x, 1.6, z], [0.34, 0.05, span + 0.15], WOOD, {}, true),
		box('bt-rack-base', 'Rack Base', [x, 0.04, z], [0.34, 0.08, span + 0.15], WOOD_DARK, {}, true),
		createSlot({
			id: 'bt-rack-sign',
			name: 'Rack Sign',
			position: [x + 0.2, 1.72, z],
			// A sign's front is its -Z side: turned -90 degrees about Y it faces +X, towards the player at the stand.
			rotation: [0, -0.7071, 0, 0.7071],
			scale: [0.9, 0.2, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#1a1020' },
				{ type: 'textDisplay', title: 'Record Rack', lines: ['Bring your own discs'], color: '#1a1020', verticalAlign: 'middle' }
			]
		})
	];
	for (let row = 0; row < DECK.rackRows; row++) {
		const shelf = rackRowY[row] - 0.15 - 0.02;
		slots.push(box(`bt-rack-shelf-${row}`, 'Rack Shelf', [x, shelf, z], [0.3, 0.04, span], WOOD, {}, true));
		slots.push(box(`bt-rack-lip-${row}`, 'Rack Lip', [x + 0.14, shelf + 0.05, z], [0.025, 0.06, span], WOOD, {}));
		for (let divider = 0; divider <= rackSlots; divider++) {
			slots.push(box(`bt-rack-divider-${row}-${divider}`, 'Rack Divider', [x, rackRowY[row], z + (divider - rackSlots / 2) * rackSlotGap], [0.28, 0.3, 0.012], WOOD_DARK));
		}
		for (let slot = 0; slot < rackSlots; slot++) {
			slots.push(
				createSlot({
					id: deckIds.rackSocket(row, slot),
					name: 'Rack Socket',
					position: [x, rackRowY[row], slotZ(slot)],
					components: [
						{
							type: 'socket',
							accepts: ['disc'],
							radius: 0.17,
							snap: { position: [0, 0, 0], rotation: [...DECK.rackSnap] },
							playMedia: false,
							...(row === 0 && slot < 2 ? { occupantId: `bt-disc-${slot + 1}` } : {})
						}
					]
				})
			);
		}
	}
	return slots;
}

/** The two bundled songs, seated in the first two slots of the rack. Both are bundled files, so the world needs no account. */
function buildDiscs(): Slot[] {
	const seat = (slot: number) => ({ parentId: deckIds.rackSocket(0, slot), position: [0, 0, 0] as [number, number, number], rotation: [...DECK.rackQuat] as [number, number, number, number] });
	return [
		...buildDisc(
			{ id: 'bt-disc-1', title: 'Remembering a Heartbeat', author: 'Hampus Naeselius', labelColor: '#9f1239', source: { kind: 'url', url: '/audio/hampus-naeselius-remembering-a-heartbeat-epidemic-fantasy.mp3' } },
			seat(0)
		),
		...buildDisc({ id: 'bt-disc-2', title: 'Ambient', author: 'Ambient 1', labelColor: '#0f766e', source: { kind: 'url', url: '/audio/ambient1.mp3' } }, seat(1))
	];
}

function buildSaber(hand: 0 | 1): Slot[] {
	const id = `bt-saber-${hand}`;
	const color = hand === 0 ? BLUE : RED;
	const glow = hand === 0 ? '#93c5fd' : '#fca5a5';
	const pose = { position: [0, 0, 0.04] as [number, number, number], rotation: [15, 0, 0] as [number, number, number] };
	return [
		createSlot({
			id,
			name: hand === 0 ? 'Blue Saber' : 'Red Saber',
			// Lying on the stand with the handle towards the player and the blade pointing at the stage.
			position: [DECK.sabers.x - 0.18 + hand * 0.36, 0.955, DECK.sabers.z],
			rotation: [0, 0, 0, 1],
			components: [{ type: 'container' }, { type: 'grabbable', scalable: false }, { type: 'equippable', left: pose, right: pose }]
		}),
		box(`${id}-handle`, 'Saber Handle', [0, 0, 0], [0.03, 0.03, 0.2], '#27272a', { parentId: id }, true),
		box(`${id}-grip`, 'Saber Grip', [0, 0, -0.02], [0.034, 0.034, 0.06], '#52525b', { parentId: id }),
		box(`${id}-guard`, 'Saber Guard', [0, 0, 0.11], [0.075, 0.016, 0.016], METAL, { parentId: id }),
		box(`${id}-blade`, 'Saber Blade', [0, 0, 0.56], [0.03, 0.03, 0.9], color, { parentId: id }),
		box(`${id}-core`, 'Saber Core', [0, 0, 0.56], [0.012, 0.012, 0.9], '#ffffff', { parentId: id }),
		box(`${id}-halo`, 'Saber Halo', [0, 0, 0.56], [0.07, 0.07, 0.94], glow, { parentId: id }, false, 0.2)
	];
}

function buildSaberStand(): Slot[] {
	const { x, z, length } = DECK.sabers;
	const centre = z - 0.1 + length / 2;
	return [
		box('bt-saber-post-0', 'Saber Stand Post', [x, 0.45, z + 0.1], [0.5, 0.9, 0.08], WOOD_DARK, {}, true),
		box('bt-saber-post-1', 'Saber Stand Post', [x, 0.45, z + length - 0.3], [0.5, 0.9, 0.08], WOOD_DARK, {}, true),
		box('bt-saber-stand', 'Saber Stand', [x, 0.915, centre], [0.8, 0.03, length], WOOD, {}, true),
		// A rest for each handle and one for each blade, so the sabers lie level and stay put.
		...[-0.18, 0.18].flatMap((dx, hand) => [
			box(`bt-saber-cradle-${hand}`, 'Saber Handle Rest', [x + dx, 0.935, z - 0.02], [0.07, 0.015, 0.05], '#1f2937'),
			box(`bt-saber-rest-${hand}`, 'Saber Blade Rest', [x + dx, 0.935, z + 0.75], [0.07, 0.015, 0.05], '#1f2937')
		]),
		...buildSaber(0),
		...buildSaber(1)
	];
}

/** The hi-fi stand, turntable, rack, discs and saber stand. */
export function buildDeckSlots(): Slot[] {
	return [...buildStand(), ...buildTurntable(), ...buildRack(), ...buildDiscs(), ...buildSaberStand()];
}
