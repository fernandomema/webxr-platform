import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { ID, KNIFE, MODELS, MODEL_IDS, PARKED, PARTS, SEAT, SURFACE, TOP, TUNING, WORKERS } from './bistroData.ts';
import type { ModelId, Vec3 } from './bistroData.ts';
import { ALONG_Z, COLOR, flatSign, group, part, pieces, sign } from './bistroLook.ts';
import type { Piece } from './bistroLook.ts';

const TINY: Vec3 = [0.001, 0.001, 0.001];

/** Something a hand can carry: the root is the thing, and its parts are what is seen. */
const carried = (id: string, name: string, extra: Slot['components'] = []): Slot =>
	createSlot({ id, name, position: PARKED, components: [{ type: 'grabbable', scalable: false, autoGrip: true }, { type: 'container' }, ...extra] });

/** A cabinet: a dark plinth, a body that stops the cook, a worktop at `TOP`, and a rail on two sides. */
function cabinet(body: string, top: string): Piece[] {
	return [
		['kick', 'box', [0, 0.05, 0], [0.9, 0.1, 0.9], COLOR.iron],
		['body', 'box', [0, 0.475, 0], [0.98, 0.75, 0.98], body, { solid: true }],
		['top', 'box', [0, TOP - 0.025, 0], [1.0, 0.05, 1.0], top],
		['rail-s', 'box', [0, 0.72, -0.5], [0.5, 0.03, 0.03], COLOR.steelDark],
		['rail-n', 'box', [0, 0.72, 0.5], [0.5, 0.03, 0.03], COLOR.steelDark]
	];
}

/** Two stacked wooden crates with bands round them: what the produce comes in. */
function crates(): Piece[] {
	return [
		['low', 'box', [0, 0.21, 0], [0.9, 0.42, 0.9], COLOR.oak, { solid: true }],
		['high', 'box', [0, 0.645, 0], [0.96, 0.45, 0.96], '#c08a52', { solid: true }],
		['band-a', 'box', [0, 0.3, 0], [0.92, 0.05, 0.92], COLOR.oakDark],
		['band-b', 'box', [0, 0.56, 0], [0.98, 0.05, 0.98], COLOR.oakDark],
		['band-c', 'box', [0, 0.78, 0], [0.98, 0.05, 0.98], COLOR.oakDark],
		['bed', 'box', [0, TOP - 0.02, 0], [0.9, 0.04, 0.9], COLOR.walnut]
	];
}

/** A heap of produce round the edge of a crate, leaving the middle for the one that can be taken. */
function heap(color: string, other: string, scale: Vec3): Piece[] {
	const spots: [number, number][] = [[-0.3, -0.28], [0.3, -0.3], [-0.31, 0.27], [0.29, 0.3], [0.33, 0], [-0.33, 0.0], [0, 0.33]];
	return spots.map(([x, z], i): Piece => [`heap-${i}`, 'sphere', [x, TOP + scale[1] / 2 - 0.01, z], scale, i % 2 ? other : color]);
}

/** The parts of each shape of appliance, in its own space: the middle of its cell, on the floor. */
function modelParts(model: ModelId, id: string): Slot[] {
	const label = (title: string) => flatSign(`${id}-label`, [0, TOP + 0.004, -0.41], 0.62, 0.13, title, 1, '#3b2a1a', id);
	switch (model) {
		case 'counter':
			return pieces(id, 'Counter', cabinet(COLOR.cream, COLOR.oak));
		case 'rack':
			return pieces(id, 'Plate Rack', [
				...cabinet(COLOR.cream, COLOR.oak),
				['tray', 'box', [0, TOP + 0.012, 0], [0.5, 0.024, 0.5], COLOR.steel],
				...([[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const).map(([x, z], i): Piece => [`post-${i}`, 'cylinder', [x, TOP + 0.14, z], [0.02, 0.28, 0.02], COLOR.steelDark])
			]);
		case 'sink':
			return pieces(id, 'Sink', [
				...cabinet(COLOR.steel, '#d5dade'),
				['basin', 'box', [0, TOP + 0.006, 0.04], [0.7, 0.012, 0.56], COLOR.steelDark],
				['water', 'box', [0, TOP + 0.014, 0.04], [0.62, 0.012, 0.48], '#7dd3fc'],
				['tap', 'cylinder', [0, TOP + 0.17, -0.37], [0.05, 0.34, 0.05], '#e5e7eb'],
				['spout', 'box', [0, TOP + 0.33, -0.27], [0.05, 0.04, 0.24], '#e5e7eb'],
				['knob-hot', 'cylinder', [-0.16, TOP + 0.04, -0.37], [0.07, 0.08, 0.07], COLOR.red],
				['knob-cold', 'cylinder', [0.16, TOP + 0.04, -0.37], [0.07, 0.08, 0.07], '#2563eb']
			]);
		case 'bin':
			return pieces(id, 'Bin', [
				['body', 'cylinder', [0, 0.38, 0], [0.62, 0.76, 0.62], COLOR.greenDark, { solid: true }],
				['rim', 'cylinder', [0, 0.775, 0], [0.68, 0.05, 0.68], COLOR.steel],
				['hole', 'cylinder', [0, 0.803, 0], [0.52, 0.012, 0.52], COLOR.ink],
				['band', 'cylinder', [0, 0.3, 0], [0.64, 0.08, 0.64], COLOR.gold],
				['pedal', 'box', [0, 0.04, -0.36], [0.2, 0.04, 0.16], COLOR.steelDark]
			]);
		case 'board':
			return pieces(id, 'Chopping Board', [
				...cabinet(COLOR.cream, COLOR.oak),
				['board', 'box', [-0.1, TOP + 0.018, 0], [0.62, 0.036, 0.5], '#e0bb85'],
				['groove', 'box', [-0.1, TOP + 0.037, 0], [0.54, 0.002, 0.42], '#c9a36b'],
				['rest', 'box', [0.36, TOP + 0.02, 0], [0.12, 0.04, 0.4], COLOR.walnut]
			]);
		case 'hob':
			return pieces(id, 'Hob', [
				...cabinet(COLOR.steel, '#24262b'),
				['ring', 'cylinder', [0, TOP + 0.006, 0], [0.56, 0.012, 0.56], '#3d4046'],
				['flame', 'cylinder', [0, TOP + 0.016, 0], [0.5, 0.012, 0.5], '#fb923c', { unlit: true }],
				['pan', 'cylinder', [0, TOP + 0.045, 0], [0.46, 0.055, 0.46], COLOR.iron],
				['pan-in', 'cylinder', [0, TOP + 0.074, 0], [0.4, 0.004, 0.4], '#4b4f55'],
				['pan-handle', 'box', [0.38, TOP + 0.055, 0], [0.32, 0.03, 0.05], COLOR.ink],
				['knob-a', 'cylinder', [-0.22, 0.73, -0.5], [0.08, 0.05, 0.08], COLOR.red, { rotation: ALONG_Z }],
				['knob-b', 'cylinder', [0.22, 0.73, -0.5], [0.08, 0.05, 0.08], COLOR.ink, { rotation: ALONG_Z }]
			]);
		case 'fryer':
			return pieces(id, 'Fryer', [
				...cabinet(COLOR.steel, '#d5dade'),
				['vat', 'box', [0, TOP + 0.045, 0], [0.74, 0.09, 0.6], '#8f969e'],
				['oil', 'box', [0, TOP + 0.092, 0], [0.66, 0.012, 0.52], '#d9a521'],
				['basket-a', 'box', [-0.26, TOP + 0.13, 0], [0.02, 0.07, 0.46], COLOR.steelDark],
				['basket-b', 'box', [0.26, TOP + 0.13, 0], [0.02, 0.07, 0.46], COLOR.steelDark],
				['basket-handle', 'box', [0, TOP + 0.15, -0.36], [0.06, 0.03, 0.26], COLOR.ink],
				['dial', 'cylinder', [0, 0.73, -0.5], [0.1, 0.05, 0.1], COLOR.gold, { rotation: ALONG_Z }]
			]);
		case 'pot':
			return pieces(id, 'Soup Pot', [
				...cabinet(COLOR.steel, '#24262b'),
				['flame', 'cylinder', [0, TOP + 0.012, 0], [0.5, 0.012, 0.5], '#fb923c', { unlit: true }],
				['pot', 'cylinder', [0, TOP + 0.18, 0], [0.54, 0.32, 0.54], '#9aa1a9'],
				['rim', 'cylinder', [0, TOP + 0.335, 0], [0.58, 0.02, 0.58], '#c5cbd1'],
				['soup', 'cylinder', [0, TOP + 0.342, 0], [0.5, 0.008, 0.5], '#6b7780'],
				['handle-a', 'box', [-0.31, TOP + 0.27, 0], [0.1, 0.03, 0.14], COLOR.ink],
				['handle-b', 'box', [0.31, TOP + 0.27, 0], [0.1, 0.03, 0.14], COLOR.ink],
				['knob', 'cylinder', [0, 0.73, -0.5], [0.08, 0.05, 0.08], COLOR.red, { rotation: ALONG_Z }]
			]);
		case 'crate_lettuce':
			return [...pieces(id, 'Lettuce Crate', [...crates(), ...heap('#4d9a2a', '#5fae36', [0.2, 0.17, 0.2])]), label('LETTUCE')];
		case 'crate_tomato':
			return [...pieces(id, 'Tomato Crate', [...crates(), ...heap('#dc2626', '#c81e1e', [0.15, 0.14, 0.15])]), label('TOMATO')];
		case 'crate_potato':
			return [...pieces(id, 'Potato Sack', [
				...crates().slice(0, 5),
				['sack', 'cylinder', [0, TOP - 0.04, 0], [0.9, 0.1, 0.9], '#c8b089'],
				['sack-roll', 'cylinder', [0, TOP + 0.02, 0], [0.96, 0.05, 0.96], '#b89f76'],
				['bed', 'cylinder', [0, TOP - 0.002, 0], [0.8, 0.02, 0.8], '#8a744f'],
				...heap('#a16207', '#8f5a09', [0.19, 0.13, 0.15])
			]), label('POTATO')];
		case 'crate_patty':
			return [...pieces(id, 'Patty Fridge', [
				['kick', 'box', [0, 0.05, 0], [0.9, 0.1, 0.9], COLOR.iron],
				['body', 'box', [0, 0.475, 0], [0.98, 0.75, 0.98], COLOR.white, { solid: true }],
				['top', 'box', [0, TOP - 0.025, 0], [1.0, 0.05, 1.0], '#d5dade'],
				['seam', 'box', [0, 0.475, -0.492], [0.02, 0.7, 0.01], COLOR.steelDark],
				['handle-a', 'box', [-0.08, 0.6, -0.51], [0.03, 0.28, 0.04], COLOR.steel],
				['handle-b', 'box', [0.08, 0.6, -0.51], [0.03, 0.28, 0.04], COLOR.steel],
				['tray', 'box', [0, TOP + 0.012, 0], [0.84, 0.024, 0.84], '#bfe3f5'],
				...([[-0.27, -0.22], [0.27, -0.22], [-0.27, 0.26], [0.27, 0.26]] as const).map(([x, z], i): Piece => [`heap-${i}`, 'cylinder', [x, TOP + 0.045, z], [0.13, 0.04, 0.13], i % 2 ? '#f4a7b3' : '#ee93a2'])
			]), label('PATTIES')];
		case 'crate_bun':
			return [...pieces(id, 'Bread Basket', [
				...crates().slice(0, 5),
				['basket', 'cylinder', [0, TOP - 0.03, 0], [0.94, 0.12, 0.94], '#c9a05f'],
				['basket-rim', 'cylinder', [0, TOP + 0.03, 0], [0.98, 0.03, 0.98], '#a67c3d'],
				['cloth', 'cylinder', [0, TOP + 0.002, 0], [0.84, 0.03, 0.84], '#f3ead7'],
				...heap('#d9a05b', '#cf9450', [0.17, 0.1, 0.17])
			]), label('BUNS')];
		case 'plant':
			return pieces(id, 'Plant', [
				['pot', 'cylinder', [0, 0.26, 0], [0.5, 0.52, 0.5], COLOR.terracotta, { solid: true }],
				['rim', 'cylinder', [0, 0.54, 0], [0.56, 0.06, 0.56], '#9c4f2e'],
				['trunk', 'cylinder', [0, 0.85, 0], [0.06, 0.6, 0.06], COLOR.oakDark],
				['leaves-a', 'sphere', [0, 1.35, 0], [0.8, 0.72, 0.8], COLOR.leaf],
				['leaves-b', 'sphere', [0.2, 1.62, 0.1], [0.5, 0.5, 0.5], COLOR.leafLight],
				['leaves-c', 'sphere', [-0.22, 1.55, -0.12], [0.46, 0.44, 0.46], '#2f7a34']
			]);
		case 'table': {
			const chair = (key: string, side: number): Piece[] => {
				const z = side * SEAT.offset;
				return [
					[`${key}-seat`, 'box', [0, SEAT.height - 0.025, z], [0.4, 0.05, 0.38], COLOR.green, { solid: true }],
					[`${key}-frame`, 'box', [0, 0.235, z], [0.36, 0.47, 0.34], COLOR.walnut, { solid: true }],
					[`${key}-back`, 'box', [0, 0.78, z + side * 0.19], [0.4, 0.56, 0.04], COLOR.walnut],
					[`${key}-slat`, 'box', [0, 0.84, z + side * 0.168], [0.3, 0.3, 0.012], COLOR.green]
				];
			};
			return [
				...pieces(id, 'Table', [
					['foot', 'cylinder', [0, 0.02, 0], [0.46, 0.04, 0.46], COLOR.iron],
					['leg', 'cylinder', [0, 0.38, 0], [0.09, 0.72, 0.09], COLOR.iron],
					['top', 'box', [0, 0.76, 0], [0.74, 0.05, 0.6], COLOR.oak, { solid: true }],
					['runner', 'box', [0, 0.787, 0], [0.74, 0.006, 0.18], COLOR.red],
					['vase', 'cylinder', [0.27, 0.84, 0], [0.05, 0.1, 0.05], COLOR.white],
					['flower', 'sphere', [0.27, 0.93, 0], [0.08, 0.08, 0.08], COLOR.gold],
					...chair('chair-a', -1),
					...chair('chair-b', 1)
				]),
				// The number of the table, on a card at its end: read from the south.
				flatSign(`${id}-number`, [-0.28, 0.79, 0], 0.14, 0.14, '1', 4, '#1f4d3a', id)
			];
		}
	}
}

/**
 * One appliance of the pool. Its root is what the script puts in a cell (and what a hand carries while the restaurant is closed:
 * the script makes it `grabbable` only then, which is also why it stops nobody then and everybody during service). The yellow
 * ball over it is the handle that says so.
 */
function station(model: ModelId, n: number): Slot[] {
	const id = ID.station(model, n);
	const slots: Slot[] = [group(id, id, PARKED), ...modelParts(model, id)];
	slots.push(
		part(`${id}-grab`, 'Handle', 'sphere', [0, model === 'plant' ? 2.0 : SURFACE[model].top + 0.42, 0], [0.12, 0.12, 0.12], COLOR.gold, { parentId: id })
	);
	if (model === 'sink' || model === 'board' || model === 'hob') slots.push(part(`${id}-trim`, 'Upgrade Trim', 'box', [0, 0.8, 0], [1.0, 0.05, 1.0], COLOR.gold, { parentId: id }));
	if (WORKERS.includes(model)) {
		// A gauge that fills as the work is done, seen from every side.
		slots.push(
			part(`${id}-gauge`, 'Gauge', 'cylinder', [0.38, SURFACE[model].top + 0.36, 0.38], [0.035, 0.4, 0.035], COLOR.ink, { parentId: id }),
			part(`${id}-fill`, 'Gauge', 'cylinder', [0.38, SURFACE[model].top + 0.16, 0.38], [0.07, 0.001, 0.07], '#22c55e', { parentId: id, unlit: true }),
			createSlot({ id: `${id}-fx`, parentId: id, name: 'Steam', position: [0, SURFACE[model].top + 0.12, 0], components: [{ type: 'particleEmitter', color: model === 'sink' ? '#dff3ff' : '#f5f5f4', capacity: 40, rate: 14, radius: 0.16, size: 0.09, lifetime: 1.3, speed: 0.35, opacity: 0.35, active: false }] })
		);
	}
	return slots;
}

/** An ingredient: five shapes that the script arranges into whatever it is (see `LOOKS`). */
function item(n: number): Slot[] {
	const id = ID.item(n);
	const shape = { ball: 'sphere', discA: 'cylinder', discB: 'cylinder', stickA: 'box', stickB: 'box' } as const;
	return [carried(id, 'Ingredient'), ...PARTS.map((key) => part(`${id}-${key}`, 'Ingredient', shape[key], [0, 0, 0], TINY, '#ffffff', { parentId: id }))];
}

function plate(n: number): Slot[] {
	const id = ID.plate(n);
	return [
		carried(id, 'Plate'),
		...pieces(id, 'Plate', [
			['disc', 'cylinder', [0, 0, 0], [0.28, 0.02, 0.28], COLOR.white],
			['well', 'cylinder', [0, 0.011, 0], [0.19, 0.004, 0.19], '#e8e6e1'],
			['dirt-a', 'cylinder', [0.04, 0.015, 0.02], TINY, '#7c5a36'],
			['dirt-b', 'cylinder', [-0.05, 0.015, -0.03], TINY, '#a8703a']
		])
	];
}

/** The knife of a chopping board. Its own little script only says that its trigger was pulled; the director does the chopping. */
const KNIFE_SCRIPT = `
return {
	onTrigger(event) {
		if (event.phase !== 'press') return true;
		const state = ctx.self.getComponent('scriptState');
		const n = ((state && state.data && state.data.n) || 0) + 1;
		ctx.world.setComponentField(ctx.self.id, 'scriptState', 'data', { n }, false);
		return true;
	}
};`;

function knife(n: number): Slot[] {
	const id = ID.knife(n);
	return [
		carried(id, 'Knife', [{ type: 'scriptState', data: { n: 0 } }, { type: 'codeBlock', code: KNIFE_SCRIPT }]),
		...pieces(id, 'Knife', [
			['handle', 'box', [0, 0, 0], [0.032, 0.03, 0.12], COLOR.ink],
			['bolster', 'box', [0, 0, 0.065], [0.036, 0.04, 0.02], COLOR.brass],
			['blade', 'box', [0, 0.012, KNIFE.blade + 0.03], [0.008, 0.055, 0.2], '#e5e7eb']
		])
	];
}

const SHIRTS = ['#2563eb', '#db2777', '#0f766e', '#d97706', '#7c3aed', '#0891b2', '#b91c1c', '#4d7c0f', '#475569', '#be185d'];
const TROUSERS = ['#1f2937', '#3f3f46', '#1e3a5f', '#44403c', '#312e81'];
const SKIN = ['#f1c9a5', '#e0ac82', '#c68642', '#8d5524', '#f5d6ba'];
const HAIR = ['#2b1d0e', '#5a3a22', '#d6b370', '#1c1917', '#9a3412', '#e5e5e5'];

/**
 * A guest: legs, a body, two arms, a head with hair, and over the head a card with the dish they want (its name, and a blob for
 * each thing that goes in it) and a bar that runs down while they wait.
 */
function guest(n: number): Slot[] {
	const id = ID.guest(n);
	return [
		group(id, 'Guest', PARKED),
		...pieces(id, 'Guest', [
			['legs', 'box', [0, 0.4, 0], [0.3, 0.8, 0.2], TROUSERS[n % TROUSERS.length]],
			['torso', 'box', [0, 1.07, 0], [0.4, 0.56, 0.23], SHIRTS[n % SHIRTS.length]],
			['arm-l', 'box', [-0.255, 1.07, 0], [0.1, 0.5, 0.12], SHIRTS[n % SHIRTS.length]],
			['arm-r', 'box', [0.255, 1.07, 0], [0.1, 0.5, 0.12], SHIRTS[n % SHIRTS.length]],
			['head', 'sphere', [0, 1.52, 0], [0.26, 0.29, 0.27], SKIN[n % SKIN.length]],
			['hair', 'sphere', [0, 1.6, -0.02], [0.28, 0.2, 0.29], HAIR[n % HAIR.length]]
		]),
		group(`${id}-bubble`, 'Order', [0, 2.06, 0], { parentId: id }),
		...pieces(`${id}-bubble`, 'Order', [
			['card', 'box', [0, 0, 0], [0.66, 0.4, 0.024], COLOR.paper],
			['tail', 'box', [0, -0.24, 0], [0.1, 0.1, 0.02], COLOR.paper, { rotation: [0, 0, 0.3826834, 0.9238795] }],
			// The blobs and the bar are thicker than the card, so they show on both of its sides.
			['chip-0', 'sphere', [-0.2, -0.06, 0], TINY, '#ffffff'],
			['chip-1', 'sphere', [0, -0.06, 0], TINY, '#ffffff'],
			['chip-2', 'sphere', [0.2, -0.06, 0], TINY, '#ffffff'],
			['bar-back', 'box', [0, -0.165, 0], [0.6, 0.056, 0.03], COLOR.ink],
			['bar', 'box', [0, -0.165, 0], [0.56, 0.036, 0.04], '#22c55e', { unlit: true }]
		]),
		// The name of the dish, on the side of the card that the bubble turns to the kitchen.
		sign(`${id}-bubble-name`, [0, 0.105, -0.014], Math.PI, 0.62, 0.15, '', [], 1.35, '#3b2a1a', `${id}-bubble`)
	];
}

/** Rings that show where what a hand holds would land. */
const marker = (n: number): Slot => part(ID.marker(n), 'Landing Mark', 'cylinder', PARKED, [0.34, 0.012, 0.34], '#4ade80', { unlit: true, opacity: 0.55 });

/** Everything that waits in a pool for the script to bring it into the restaurant. */
export function buildProps(): Slot[] {
	const slots: Slot[] = [];
	for (const model of MODEL_IDS) for (let n = 0; n < MODELS[model]; n++) slots.push(...station(model, n));
	for (let n = 0; n < TUNING.items; n++) slots.push(...item(n));
	for (let n = 0; n < TUNING.platesMax; n++) slots.push(...plate(n));
	for (let n = 0; n < MODELS.board; n++) slots.push(...knife(n));
	for (let n = 0; n < TUNING.guests; n++) slots.push(...guest(n));
	for (let n = 0; n < TUNING.markers; n++) slots.push(marker(n));
	return slots;
}
