// Builds src/lib/xr/templates/popUpStore.json: the Pop Up Store, a bright little shop where players find toys and tools
// to take away. Every product sits on a display stand that puts a new one in its place when it is taken (see
// store-products.mjs), so anyone can take anything, as many times as they like, and keep it with Menu > Save.
// Run with `node scripts/generate-pop-up-store.mjs`.
//
// The player arrives on the plaza in front of the shop, looking at its storefront (towards -Z; +X is on their left).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACING, createWorld, mesh, pitch, round, solid, yaw } from './world-kit.mjs';
import { PRODUCTS, productSlots, standScript } from './store-products.mjs';

const LEFT = 1, RIGHT = -1;
/** The shop: its inside runs from the storefront (z = FRONT) to the back wall, between the side walls at ±HALF. */
const HALF = 9, FRONT = -3, BACK = -25, HEIGHT = 4.5, WALL = 0.3;
const INNER = HALF - WALL / 2; // x of the inner face of a side wall
const midZ = (FRONT + BACK) / 2;

const COLORS = {
	pavement: '#aeb5bd',
	sidewalk: '#d1d5db',
	facade: '#fef3e2',
	coral: '#fb7185',
	sun: '#fcd34d',
	mint: '#5eead4',
	sky: '#7dd3fc',
	lilac: '#c4b5fd',
	wall: '#fbf7f0',
	floor: '#f3e8d8',
	display: '#f8fafc',
	dark: '#1f2937',
	wood: '#b7875a',
	steel: '#475569',
	leaf: '#22a35a',
	pot: '#c2703d'
};

const { slots, slot, group, box, floor, sign } = createWorld();

// Hamilton product: `a` applied after `b`.
const qMul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];

// --- plaza --------------------------------------------------------------------------------------------------------------
slot('popup-sky', 'Afternoon Sky', null, { components: [{ type: 'skybox', topColor: '#4f86e8', horizonColor: '#fde2c8', bottomColor: '#3a3f4b', stars: 0 }] });
floor('floor', 'Plaza', null, [-22, 22], [-32, 10], 0, COLORS.pavement);

group('popup-plaza', 'Plaza');
box('popup-sidewalk', 'Sidewalk', 'popup-plaza', [0, 0.006, FRONT + 1.4], [2 * HALF + 3, 0.01, 2.6], COLORS.sidewalk, true);
slot('popup-pad-ring', 'Arrival Pad Ring', 'popup-plaza', { position: [0, 0.012, 1.5], scale: [3.2, 0.02, 3.2], components: [mesh('cylinder', COLORS.coral)] });
slot('popup-pad', 'Arrival Pad', 'popup-plaza', { position: [0, 0.016, 1.5], scale: [2.8, 0.02, 2.8], components: [mesh('cylinder', COLORS.facade)] });
for (const side of [LEFT, RIGHT]) {
	const s = side === LEFT ? 'l' : 'r';
	// A bench facing the shop, and a street lamp.
	box(`popup-bench-${s}-seat`, 'Bench Seat', 'popup-plaza', [side * 5.5, 0.45, 2.2], [1.8, 0.08, 0.5], COLORS.wood);
	box(`popup-bench-${s}-back`, 'Bench Back', 'popup-plaza', [side * 5.5, 0.75, 2.45], [1.8, 0.45, 0.06], COLORS.wood, true);
	for (const dx of [-0.8, 0.8]) box(`popup-bench-${s}-leg-${dx > 0 ? 'a' : 'b'}`, 'Bench Leg', 'popup-plaza', [side * 5.5 + dx, 0.2, 2.2], [0.08, 0.4, 0.45], COLORS.steel, true);
	slot(`popup-lamp-${s}-pole`, 'Street Lamp Pole', 'popup-plaza', { position: [side * 10.5, 1.6, 0.5], scale: [0.12, 3.2, 0.12], components: [mesh('cylinder', COLORS.dark), solid] });
	slot(`popup-lamp-${s}-globe`, 'Street Lamp', 'popup-plaza', { position: [side * 10.5, 3.35, 0.5], scale: [0.45, 0.45, 0.45], components: [mesh('sphere', '#fef9c3')] });
}

function plant(id, parentId, x, z, size = 1) {
	slot(`${id}-pot`, 'Plant Pot', parentId, { position: [x, 0.25 * size, z], scale: [0.5 * size, 0.5 * size, 0.5 * size], components: [mesh('cylinder', COLORS.pot), solid] });
	slot(`${id}-leaves`, 'Plant', parentId, { position: [x, 0.78 * size, z], scale: [0.75 * size, 0.7 * size, 0.75 * size], components: [mesh('sphere', COLORS.leaf)] });
	slot(`${id}-top`, 'Plant', parentId, { position: [x + 0.08 * size, 1.1 * size, z - 0.05 * size], scale: [0.45 * size, 0.45 * size, 0.45 * size], components: [mesh('sphere', '#34c46e')] });
}
plant('popup-plant-door-l', 'popup-plaza', LEFT * 2.5, FRONT + 0.6, 0.9);
plant('popup-plant-door-r', 'popup-plaza', RIGHT * 2.5, FRONT + 0.6, 0.9);

// --- the shop's shell ---------------------------------------------------------------------------------------------------
group('popup-shop', 'Shop');
const length = FRONT - BACK;
box('popup-wall-left', 'Wall Left', 'popup-shop', [LEFT * HALF, HEIGHT / 2, midZ], [WALL, HEIGHT, length + WALL], COLORS.wall);
box('popup-wall-right', 'Wall Right', 'popup-shop', [RIGHT * HALF, HEIGHT / 2, midZ], [WALL, HEIGHT, length + WALL], COLORS.wall);
box('popup-wall-back', 'Wall Back', 'popup-shop', [0, HEIGHT / 2, BACK], [2 * HALF + WALL, HEIGHT, WALL], COLORS.wall);
// A band of colour low on every inside wall, and a coral line along their tops.
for (const [id, center, size] of [
	['left', [LEFT * (INNER - 0.02), 0.5, midZ], [0.04, 1, length - WALL]],
	['right', [RIGHT * (INNER - 0.02), 0.5, midZ], [0.04, 1, length - WALL]],
	['back', [0, 0.5, BACK + WALL / 2 + 0.02], [2 * INNER, 1, 0.04]]
]) {
	box(`popup-wainscot-${id}`, 'Wall Colour Band', 'popup-shop', center, size, COLORS.mint, true);
	box(`popup-trim-${id}`, 'Wall Top Trim', 'popup-shop', [center[0], HEIGHT - 0.15, center[2]], [size[0], 0.3, size[2]], COLORS.coral, true);
}
box('popup-floor-inside', 'Shop Floor', 'popup-shop', [0, 0.008, midZ], [2 * INNER, 0.012, length - WALL], COLORS.floor, true);

// The storefront: a doorway in the middle and a display window on each side, under striped awnings.
group('popup-storefront', 'Storefront', 'popup-shop');
const DOOR = 1.8, WINDOW = [3.2, 7.8], SILL = 0.8, LINTEL = 2.8, DOOR_TOP = 3;
const front = (id, name, x0, x1, y0, y1, color = COLORS.facade) => box(id, name, 'popup-storefront', [(x0 + x1) / 2, (y0 + y1) / 2, FRONT], [x1 - x0, y1 - y0, WALL], color);
for (const side of [LEFT, RIGHT]) {
	const s = side === LEFT ? 'l' : 'r';
	const span = (a, b) => [Math.min(side * a, side * b), Math.max(side * a, side * b)];
	front(`popup-front-${s}-corner`, 'Storefront Pillar', ...span(WINDOW[1], HALF + WALL / 2), 0, HEIGHT, COLORS.coral);
	front(`popup-front-${s}-pier`, 'Storefront Pier', ...span(DOOR, WINDOW[0]), 0, HEIGHT);
	front(`popup-front-${s}-sill`, 'Display Window Sill', ...span(WINDOW[0], WINDOW[1]), 0, SILL);
	front(`popup-front-${s}-lintel`, 'Display Window Lintel', ...span(WINDOW[0], WINDOW[1]), LINTEL, HEIGHT);
	// A coral frame round the window.
	const [x0, x1] = span(WINDOW[0], WINDOW[1]);
	box(`popup-window-${s}-frame-top`, 'Window Frame', 'popup-storefront', [(x0 + x1) / 2, LINTEL, FRONT + WALL / 2 + 0.02], [x1 - x0 + 0.1, 0.1, 0.06], COLORS.coral, true);
	box(`popup-window-${s}-frame-bottom`, 'Window Frame', 'popup-storefront', [(x0 + x1) / 2, SILL, FRONT + WALL / 2 + 0.02], [x1 - x0 + 0.1, 0.1, 0.06], COLORS.coral, true);
	for (const [end, x] of [['a', x0], ['b', x1]]) box(`popup-window-${s}-frame-${end}`, 'Window Frame', 'popup-storefront', [x, (SILL + LINTEL) / 2, FRONT + WALL / 2 + 0.02], [0.1, LINTEL - SILL, 0.06], COLORS.coral, true);
}
front('popup-front-door-head', 'Door Header', -DOOR, DOOR, DOOR_TOP, HEIGHT);
// The facade rises above the walls, with the shop's name on it.
box('popup-facade', 'Facade', 'popup-storefront', [0, HEIGHT + 0.8, FRONT], [2 * HALF + WALL, 1.6, WALL], COLORS.facade, true);
box('popup-facade-trim', 'Facade Trim', 'popup-storefront', [0, HEIGHT + 1.65, FRONT], [2 * HALF + WALL + 0.1, 0.1, WALL + 0.1], COLORS.coral, true);
sign('popup-name', 'popup-storefront', [0, HEIGHT + 0.8, FRONT + WALL / 2 + 0.03], [6.4, 1.3], '+z', { title: 'POP UP STORE', lines: ['Toys · Tools · Fun · Everything free'], scale: 2.6 }, COLORS.sun, COLORS.dark);

// Striped awnings leaning out over the plaza.
function awning(id, x0, x1, top) {
	const depth = 1.3, tilt = (22 * Math.PI) / 180;
	const stripes = Math.max(2, Math.round((x1 - x0) / 0.75));
	const w = (x1 - x0) / stripes;
	const center = [0, top - (Math.sin(tilt) * depth) / 2, FRONT + WALL / 2 + (Math.cos(tilt) * depth) / 2];
	for (let i = 0; i < stripes; i++) {
		box(`${id}-${i}`, 'Awning Stripe', 'popup-storefront', [x0 + w * (i + 0.5), center[1], center[2]], [w, 0.04, depth], i % 2 ? COLORS.facade : COLORS.coral, true);
		slots[slots.length - 1].rotation = pitch(tilt).map(round);
	}
}
awning('popup-awning-door', -DOOR - 0.3, DOOR + 0.3, DOOR_TOP + 0.35);
awning('popup-awning-l', LEFT * WINDOW[1], LEFT * WINDOW[0], LINTEL + 0.35);
awning('popup-awning-r', RIGHT * WINDOW[1], RIGHT * WINDOW[0], LINTEL + 0.35);

// An open roof of white beams, with lamps hanging over the displays.
group('popup-roof', 'Roof and Lamps', 'popup-shop');
for (const [i, z] of [-6, -10, -14, -18, -22].entries()) {
	box(`popup-beam-${i}`, 'Roof Beam', 'popup-roof', [0, HEIGHT + 0.15, z], [2 * HALF + 0.4, 0.3, 0.25], '#ffffff', true);
}
function pendant(id, x, z, color) {
	const y = 3.1;
	slot(`${id}-cord`, 'Lamp Cord', 'popup-roof', { position: [x, (HEIGHT + y) / 2, z], scale: [0.02, HEIGHT - y, 0.02], components: [mesh('cylinder', COLORS.dark)] });
	slot(`${id}`, 'Pendant Lamp', 'popup-roof', { position: [x, y, z], scale: [0.5, 0.3, 0.5], components: [mesh('sphere', color)] });
}

// --- display stands -----------------------------------------------------------------------------------------------------

/**
 * A display stand for `productId`, standing at `base` (world, on whatever it rests on) and facing `facing` (radians about
 * the vertical; its front is +Z). Its riser, the Spot the product sits on, a price tag, the script that restocks it, and
 * the first product already in place.
 */
function stand(key, parentId, productId, base, facing, { riser = [0.22, 0.07, 0.22], color = COLORS.display } = {}) {
	const product = PRODUCTS[productId];
	const id = `popup-stand-${key}`;
	const rotation = yaw(facing);
	slot(id, `Display: ${product.name}`, parentId, { position: base, rotation, components: [{ type: 'codeBlock', code: standScript(product) }] });
	slot(`${id}-riser`, 'Riser', id, { position: [0, riser[1] / 2, 0], scale: riser, components: [mesh('box', color)] });
	slot(`${id}-spot`, 'Spot', id, { position: [0, riser[1], 0] });
	slot(`${id}-tag`, 'Price Tag', id, {
		position: [0, riser[1] / 2, riser[2] / 2 + 0.004],
		rotation: [0, 1, 0, 0],
		scale: [Math.min(riser[0] * 0.92, 0.2), Math.min(riser[1] * 0.85, 0.06), 1],
		components: [mesh('plane', COLORS.dark), { type: 'textDisplay', title: product.name, lines: ['FREE'], color: COLORS.dark, scale: 1.6 }]
	});
	// The first one, already on the stand: it belongs to no one, and the stand will recognise it as its own.
	const spot = base.map((v, i) => v + (i === 1 ? riser[1] : 0));
	const copy = productSlots(product);
	const ids = new Map(copy.map((s) => [s.id, `${id}-item${s.id === product.id ? '' : s.id.slice(product.id.length)}`]));
	for (const s of copy) {
		const root = s.parentId === null;
		slot(ids.get(s.id), s.name, root ? null : ids.get(s.parentId), {
			position: root ? spot : s.position,
			rotation: root ? qMul(rotation, s.rotation) : s.rotation,
			scale: s.scale,
			components: JSON.parse(JSON.stringify(s.components))
		});
	}
}

/** Stands in a row along a surface: `along` is the row's direction (unit, horizontal), products are spread evenly. */
function row(key, parentId, productIds, center, along, spacing, facing, options) {
	productIds.forEach((productId, i) => {
		const offset = (i - (productIds.length - 1) / 2) * spacing;
		stand(`${key}-${i}`, parentId, productId, center.map((v, k) => v + along[k] * offset), facing, options);
	});
}

// Display windows: a podium behind each window, its products facing out to the plaza.
group('popup-windows', 'Window Displays');
for (const [side, products] of [[LEFT, ['giant-teddy', 'glow-wand']], [RIGHT, ['balloon-red', 'toy-rocket']]]) {
	const s = side === LEFT ? 'l' : 'r';
	const x = (side * (WINDOW[0] + WINDOW[1])) / 2, z = FRONT - WALL / 2 - 0.7, top = 0.75;
	box(`popup-podium-${s}`, 'Window Podium', 'popup-windows', [x, top / 2, z], [WINDOW[1] - WINDOW[0] - 0.4, top, 1.1], COLORS.lilac);
	row(`window-${s}`, 'popup-windows', products, [x, top, z], [1, 0, 0], 1.6, 0, { riser: [0.4, 0.07, 0.4] });
}

// The entrance: how the shop works, and where things are.
group('popup-entrance', 'Entrance');
function standingSign(id, x, z, text) {
	const y = 1.7;
	sign(id, 'popup-entrance', [x, y, z], [1.4, 1.2], '+z', text, COLORS.coral);
	for (const [suffix, dx] of [['l', -0.6], ['r', 0.6]]) {
		slot(`${id}-leg-${suffix}`, `${text.title} Sign Leg`, 'popup-entrance', { position: [x + dx, (y - 0.66) / 2, z - 0.03], scale: [0.06, y - 0.66, 0.06], components: [mesh('cylinder', COLORS.dark), solid] });
	}
}
standingSign('popup-how', RIGHT * 3.2, FRONT - 2.2, { title: 'Take one!', lines: ['Everything here is free.', 'Take anything on display:', 'a new one takes its place.', 'Menu > Save keeps it', 'in your inventory.'] });
standingSign('popup-map', LEFT * 3.2, FRONT - 2.2, { title: 'In the store', lines: ['Left: Toys', 'Right: Tools', 'Middle: New & Fun, Party', 'At the back: Featured'] });
box('popup-mat', 'Door Mat', 'popup-entrance', [0, 0.016, FRONT - 0.9], [2.6, 0.012, 1.2], COLORS.coral, true);

// New & Fun: a round table just inside, its products facing every way.
group('popup-new', 'New & Fun');
const NEW_Z = -9;
slot('popup-new-rug', 'Rug', 'popup-new', { position: [0, 0.016, NEW_Z], scale: [4.4, 0.01, 4.4], components: [mesh('cylinder', '#fecdd3')] });
slot('popup-new-table', 'Round Table', 'popup-new', { position: [0, 0.425, NEW_Z], scale: [2.3, 0.85, 2.3], components: [mesh('cylinder', COLORS.display), solid] });
slot('popup-new-top', 'Table Top', 'popup-new', { position: [0, 0.855, NEW_Z], scale: [2.35, 0.02, 2.35], components: [mesh('cylinder', COLORS.mint)] });
['party-popper', 'magic-ball', 'bubble-wand', 'fidget-spinner'].forEach((productId, i) => {
	const a = Math.PI / 4 + (i * Math.PI) / 2;
	stand(`new-${i}`, 'popup-new', productId, [Math.sin(a) * 0.72, 0.865, NEW_Z + Math.cos(a) * 0.72], a);
});
sign('popup-new-sign', 'popup-new', [0, 3.2, NEW_Z], [2, 0.9], '+z', { title: 'New & Fun', scale: 2.4 }, COLORS.coral);
[-0.9, 0, 0.9].forEach((dx, i) => pendant(`popup-new-lamp-${i}`, dx, NEW_Z - 0.6, '#fef08a'));

// Toys: shelving along the left wall.
group('popup-toys', 'Toys');
const SHELF_LEVELS = [0.45, 1.05, 1.65];
const shelfX = LEFT * (INNER - 0.25);
[
	[-10, ['rubber-duck', 'teddy-bear', 'dice', 'maracas', 'balloon-blue', 'glow-wand']],
	[-14.5, ['fidget-spinner', 'magic-ball', 'party-popper', 'bubble-wand', 'balloon-yellow', 'toy-rocket']]
].forEach(([z, products], unit) => {
	const g = `popup-toy-shelf-${unit}`;
	for (const [end, dz] of [['a', -1.6], ['b', 1.6]]) box(`${g}-side-${end}`, 'Shelving Upright', 'popup-toys', [shelfX, 1.2, z + dz], [0.5, 2.4, 0.06], COLORS.wood);
	box(`${g}-back`, 'Shelving Back', 'popup-toys', [LEFT * (INNER - 0.02), 1.2, z], [0.03, 2.4, 3.2], COLORS.sky, true);
	SHELF_LEVELS.forEach((y, level) => {
		box(`${g}-shelf-${level}`, 'Shelf', 'popup-toys', [shelfX, y - 0.02, z], [0.5, 0.04, 3.2], COLORS.wood, true);
		// Facing into the room (-X, away from the left wall).
		row(`toys-${unit}-${level}`, 'popup-toys', products.slice(level * 2, level * 2 + 2), [shelfX, y, z], [0, 0, 1], 1.4, -Math.PI / 2, { riser: [0.24, 0.06, 0.24] });
	});
});
sign('popup-toys-sign', 'popup-toys', [LEFT * (INNER - 0.03), 3.3, -12.25], [2.4, 1], '-x', { title: 'Toys', lines: ['Take one: a new one appears'], scale: 2.2 }, COLORS.sun);

// Tools: the Workshop's tools on a counter along the right wall, to take to any world.
group('popup-tools', 'Tools');
const TOOL_Z = -11.5, counterX = RIGHT * (INNER - 0.35);
box('popup-tools-counter', 'Tool Counter', 'popup-tools', [counterX, 0.45, TOOL_Z], [0.7, 0.9, 7.6], COLORS.wood);
box('popup-tools-counter-top', 'Tool Counter Top', 'popup-tools', [counterX, 0.91, TOOL_Z], [0.74, 0.02, 7.64], COLORS.dark, true);
box('popup-tools-pegboard', 'Pegboard', 'popup-tools', [RIGHT * (INNER - 0.03), 1.8, TOOL_Z], [0.04, 1.4, 7.4], '#d6b27c', true);
// Facing into the room (+X, away from the right wall).
row('tools', 'popup-tools', ['tool-shape-maker', 'tool-copier', 'tool-eraser', 'tool-paint-brush', 'tool-color-sprayer', 'tool-tape-measure', 'tool-aligner'], [counterX, 0.92, TOOL_Z], [0, 0, 1], 1.02, Math.PI / 2, { riser: [0.32, 0.05, 0.32], color: '#e2e8f0' });
sign('popup-tools-sign', 'popup-tools', [RIGHT * (INNER - 0.06), 3.25, TOOL_Z], [2.4, 1], '+x', { title: 'Tools', lines: ['From the Workshop:', 'take them to any world'], scale: 2 }, COLORS.sky);

// Party: a long table in the middle, balloons on one side.
group('popup-party', 'Party');
const PARTY_Z = -15.5;
box('popup-party-rug', 'Rug', 'popup-party', [0, 0.016, PARTY_Z], [5.2, 0.01, 3.2], '#bae6fd', true);
box('popup-party-table', 'Party Table', 'popup-party', [0, 0.425, PARTY_Z], [3.4, 0.85, 1.3], COLORS.display);
box('popup-party-top', 'Table Top', 'popup-party', [0, 0.86, PARTY_Z], [3.44, 0.02, 1.34], COLORS.coral, true);
row('party-front', 'popup-party', ['balloon-red', 'balloon-blue', 'balloon-yellow'], [0, 0.87, PARTY_Z + 0.32], [1, 0, 0], 1.05, 0);
row('party-back', 'popup-party', ['party-popper', 'toy-rocket'], [0, 0.87, PARTY_Z - 0.32], [1, 0, 0], 1.4, Math.PI);
sign('popup-party-sign', 'popup-party', [0, 3.2, PARTY_Z], [1.8, 0.9], '+z', { title: 'Party!', scale: 2.6 }, COLORS.lilac);
[-1.2, 0, 1.2].forEach((dx, i) => pendant(`popup-party-lamp-${i}`, dx, PARTY_Z - 0.2, '#fbcfe8'));

// Featured: a low stage at the back, three big pieces on pedestals.
group('popup-featured', 'Featured');
const STAGE = { x: [-5, 5], z: [BACK + WALL / 2, -21], height: 0.3, step: 0.6 };
const stageZ = (STAGE.z[0] + STAGE.z[1]) / 2;
box('popup-stage', 'Stage', 'popup-featured', [0, STAGE.height / 2, stageZ], [10, STAGE.height, STAGE.z[1] - STAGE.z[0]], COLORS.lilac, true);
floor('popup-stage-floor', 'Stage Floor', 'popup-featured', STAGE.x, STAGE.z, STAGE.height + 0.001, '#ddd6fe');
box('popup-stage-step', 'Stage Step', 'popup-featured', [0, STAGE.height / 4, STAGE.z[1] + STAGE.step / 2], [10, STAGE.height / 2, STAGE.step], COLORS.lilac, true);
floor('popup-stage-step-floor', 'Stage Step Floor', 'popup-featured', STAGE.x, [STAGE.z[1], STAGE.z[1] + STAGE.step], STAGE.height / 2 + 0.001, '#ddd6fe');
[['giant-duck', -3], ['disco-ball', 0], ['giant-teddy', 3]].forEach(([productId, x], i) => {
	const top = STAGE.height + 0.7;
	slot(`popup-pedestal-${i}`, 'Pedestal', 'popup-featured', { position: [x, STAGE.height + 0.35, stageZ], scale: [1, 0.7, 1], components: [mesh('cylinder', COLORS.display), solid] });
	stand(`featured-${i}`, 'popup-featured', productId, [x, top, stageZ], 0, { riser: [0.6, 0.05, 0.6], color: COLORS.sun });
});
sign('popup-featured-sign', 'popup-featured', [0, 3.4, BACK + WALL / 2 + 0.03], [3, 1.1], '+z', { title: 'Featured', lines: ['Big, shiny, and free'], scale: 2.4 }, COLORS.sun);
[-3, 0, 3].forEach((x, i) => pendant(`popup-stage-lamp-${i}`, x, stageZ + 0.6, '#fef9c3'));

// Checkout: a counter at the back right, with nothing to pay.
group('popup-checkout', 'Checkout');
const CHECK = { x: RIGHT * 6.6, z: -19.2 };
box('popup-checkout-counter', 'Checkout Counter', 'popup-checkout', [CHECK.x, 0.5, CHECK.z], [2.6, 1, 0.8], COLORS.coral);
box('popup-checkout-top', 'Counter Top', 'popup-checkout', [CHECK.x, 1.01, CHECK.z], [2.66, 0.03, 0.86], COLORS.dark, true);
box('popup-register', 'Register', 'popup-checkout', [CHECK.x - RIGHT * 0.6, 1.12, CHECK.z], [0.4, 0.2, 0.35], COLORS.steel);
slot('popup-register-screen', 'Register Screen', 'popup-checkout', {
	position: [CHECK.x - RIGHT * 0.6, 1.35, CHECK.z + 0.1],
	rotation: [0, 1, 0, 0],
	scale: [0.34, 0.22, 1],
	components: [mesh('plane', '#064e3b'), { type: 'textDisplay', title: 'Total: 0', lines: ['Thank you!'], color: '#064e3b', scale: 1.4 }]
});
sign('popup-checkout-sign', 'popup-checkout', [RIGHT * (INNER - 0.06), 2.9, CHECK.z], [2.2, 1], '+x', { title: 'Checkout', lines: ['Nothing to pay here:', 'everything is free'], scale: 1.8 }, COLORS.coral);

// A mirror to see yourself with what you took, and plants in the corners.
group('popup-decor', 'Decor');
const MIRROR_Z = -20;
box('popup-mirror-frame', 'Mirror Frame', 'popup-decor', [LEFT * (INNER - 0.03), 1.4, MIRROR_Z], [0.06, 2.3, 1.5], COLORS.coral, true);
slot('popup-mirror', 'Mirror', 'popup-decor', { position: [LEFT * (INNER - 0.065), 1.4, MIRROR_Z], rotation: FACING['-x'], scale: [1.34, 2.14, 1], components: [mesh('plane'), { type: 'mirror', resolution: 1024 }] });
sign('popup-mirror-sign', 'popup-decor', [LEFT * (INNER - 0.05), 2.95, MIRROR_Z], [1.1, 0.45], '-x', { title: 'Looking good!', scale: 1.4 }, COLORS.coral);
plant('popup-plant-fl', 'popup-decor', LEFT * 8.1, FRONT - 1.9);
plant('popup-plant-fr', 'popup-decor', RIGHT * 8.1, FRONT - 1.9);
plant('popup-plant-bl', 'popup-decor', LEFT * 8.1, BACK + 0.9);
plant('popup-plant-br', 'popup-decor', RIGHT * 8.1, BACK + 0.9);

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/xr/templates/popUpStore.json');
writeFileSync(out, JSON.stringify(slots, null, '\t') + '\n');
const stands = slots.filter((s) => s.name.startsWith('Display: ')).length;
console.log(`Wrote ${slots.length} slots (${stands} display stands) to ${out}`);
