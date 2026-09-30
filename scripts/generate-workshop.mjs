// Builds src/lib/xr/templates/workshop.json: the Workshop, a large hall for building in VR. This is its structure
// only (the building, the work bays with their benches, pegboards and shelves, the build floor and the showcase stage);
// the tools that fill the bays are added separately. Run with `node scripts/generate-workshop.mjs`.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, TOOL_BASICS, toolEquippable } from './workshop-tools.mjs';

// Babylon space: +Y up. As in the lobby, a player arriving at the origin looks towards -Z, so the hall runs from the
// entrance (z = 6, behind the player) to the showcase stage (z = -34). Babylon is left-handed, so looking that way
// +X is on the player's left. Built-in meshes are 1 m (the ground is 20 m).
const LEFT = 1, RIGHT = -1;
const HALL = { halfWidth: 16, front: 6, back: -34, wallHeight: 4, bandBottom: 6.4, top: 7.2, wall: 0.4 };
const COLUMN_Z = [6, -2, -10, -18, -26, -34];
const COLUMN_X = [-8, 0, 8];

const COLORS = {
	floor: '#4b5058',
	wall: '#cfc8b8',
	wainscot: '#5a6472',
	band: '#3b4552',
	steel: '#2c3440',
	roof: '#334155',
	lampShade: '#fde68a',
	cord: '#1f2937',
	pegboard: '#b08d57',
	benchTop: '#a0764a',
	benchFrame: '#374151',
	shelf: '#6b7280',
	signText: '#111827',
	safety: '#f59e0b',
	buildFloor: '#2b3038',
	gridLine: '#5b6574',
	stage: '#1f2937',
	stageTop: '#374151',
	plinth: '#e5e7eb',
	door: '#475569'
};

/** The six work bays, three along each side wall, nearest the entrance first. Their tools come in a later phase. */
const BAYS = [
	{ id: 'shapes', side: LEFT, index: 0, title: 'Shapes', lines: ['Boxes, spheres, cylinders', 'and building blocks'], color: '#8b5cf6' },
	{ id: 'paint', side: RIGHT, index: 0, title: 'Paint & Color', lines: ['Brushes, colors', 'and surface coatings'], color: '#f97316' },
	{ id: 'measure', side: LEFT, index: 1, title: 'Measure & Align', lines: ['Rulers, grids', 'and alignment guides'], color: '#eab308' },
	{ id: 'logic', side: RIGHT, index: 1, title: 'Logic & Scripts', lines: ['Buttons, scripts', 'and interactions'], color: '#22c55e' },
	{ id: 'media', side: LEFT, index: 2, title: 'Sound & Media', lines: ['Audio, screens', 'and text displays'], color: '#06b6d4' },
	{ id: 'effects', side: RIGHT, index: 2, title: 'Effects', lines: ['Particles, motion', 'and skies'], color: '#ec4899' }
];

const IDENTITY = [0, 0, 0, 1];
const s45 = Math.SQRT1_2;
/** A plane (and so a sign) is seen from the side its -Z faces; these turn it to be read from the given direction. */
const FACING = { '+z': [0, 1, 0, 0], '-z': IDENTITY, '+x': [0, -s45, 0, s45], '-x': [0, s45, 0, s45] };

const round = (v) => Math.round(v * 10000) / 10000;
const slots = [];

function slot(id, name, parentId, { position = [0, 0, 0], rotation = IDENTITY, scale = [1, 1, 1], components = [] } = {}) {
	slots.push({ id, parentId, name, position: position.map(round), rotation: rotation.map(round), scale: scale.map(round), components });
	return id;
}

const mesh = (id, color) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, ...(color ? { color } : {}) });
const solid = { type: 'collider', shape: 'box' };
const group = (id, name, parentId = null) => slot(id, name, parentId, { components: [{ type: 'container' }] });

/** A box given by its centre and size, solid (blocks the player) unless `walkThrough`. */
function box(id, name, parentId, center, size, color, walkThrough = false) {
	return slot(id, name, parentId, { position: center, scale: size, components: [mesh('box', color), ...(walkThrough ? [] : [solid])] });
}

/** A walkable, teleportable surface at height `y`, spanning x0..x1 by z0..z1. */
function floor(id, name, parentId, [x0, x1], [z0, z1], y, color) {
	return slot(id, name, parentId, {
		position: [(x0 + x1) / 2, y, (z0 + z1) / 2],
		scale: [(x1 - x0) / 20, 1, (z1 - z0) / 20],
		components: [mesh('ground', color), solid]
	});
}

/**
 * A sign: a coloured frame with the text panel just in front of it, read from `facing`. A text display draws onto a square
 * texture whatever the panel's shape, so signs are kept close to square for the text not to stretch.
 */
function sign(id, parentId, center, [width, height], facing, text, frameColor) {
	const normal = { '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0] }[facing];
	const across = facing.endsWith('x') ? [0.04, height + 0.12, width + 0.12] : [width + 0.12, height + 0.12, 0.04];
	box(`${id}-frame`, `${text.title} Sign Frame`, parentId, center, across, frameColor, true);
	slot(id, `${text.title} Sign`, parentId, {
		position: center.map((v, i) => v + normal[i] * 0.03),
		rotation: FACING[facing],
		scale: [width, height, 1],
		components: [mesh('plane', COLORS.signText), { type: 'textDisplay', title: text.title, lines: text.lines, color: COLORS.signText }]
	});
}

// --- The building ---------------------------------------------------------------------------------------------------
const { halfWidth: W, front: F, back: B, wallHeight: H, bandBottom, top: T, wall: t } = HALL;
const length = F - B;
const midZ = (F + B) / 2;

slot('workshop-skybox', 'Skybox', null, { components: [{ type: 'skybox', topColor: '#1b2a4a', horizonColor: '#f2a65a', bottomColor: '#1f2328', stars: 0.3 }] });
floor('floor', 'Floor', null, [-W - 1, W + 1], [B - 1, F + 1], 0, COLORS.floor);

group('workshop-building', 'Building');
box('workshop-wall-left', 'Wall Left', 'workshop-building', [LEFT * W, H / 2, midZ], [t, H, length + t], COLORS.wall);
box('workshop-wall-right', 'Wall Right', 'workshop-building', [RIGHT * W, H / 2, midZ], [t, H, length + t], COLORS.wall);
box('workshop-wall-back', 'Wall Back', 'workshop-building', [0, H / 2, B], [2 * W + t, H, t], COLORS.wall);
box('workshop-wall-front', 'Wall Entrance', 'workshop-building', [0, H / 2, F], [2 * W + t, H, t], COLORS.wall);
// Between the walls and the band above them the hall is open: tall windows onto the sky, between the columns.
const bandY = (bandBottom + T) / 2, bandH = T - bandBottom;
box('workshop-band-left', 'Upper Band Left', 'workshop-building', [LEFT * W, bandY, midZ], [t, bandH, length + t], COLORS.band, true);
box('workshop-band-right', 'Upper Band Right', 'workshop-building', [RIGHT * W, bandY, midZ], [t, bandH, length + t], COLORS.band, true);
box('workshop-band-back', 'Upper Band Back', 'workshop-building', [0, bandY, B], [2 * W + t, bandH, t], COLORS.band, true);
box('workshop-band-front', 'Upper Band Entrance', 'workshop-building', [0, bandY, F], [2 * W + t, bandH, t], COLORS.band, true);
// A darker skirting along the inside of every wall, where benches and feet scuff it.
const inner = t / 2 + 0.025;
box('workshop-wainscot-left', 'Wainscot Left', 'workshop-building', [LEFT * (W - inner), 0.6, midZ], [0.05, 1.2, length - t], COLORS.wainscot, true);
box('workshop-wainscot-right', 'Wainscot Right', 'workshop-building', [RIGHT * (W - inner), 0.6, midZ], [0.05, 1.2, length - t], COLORS.wainscot, true);
box('workshop-wainscot-back', 'Wainscot Back', 'workshop-building', [0, 0.6, B + inner], [2 * W - t, 1.2, 0.05], COLORS.wainscot, true);
box('workshop-wainscot-front', 'Wainscot Entrance', 'workshop-building', [0, 0.6, F - inner], [2 * W - t, 1.2, 0.05], COLORS.wainscot, true);
box('workshop-door', 'Loading Door', 'workshop-building', [RIGHT * 6, 1.9, F - inner - 0.03], [4.2, 3.8, 0.06], COLORS.door, true);

group('workshop-structure', 'Columns and Roof', 'workshop-building');
for (const [i, z] of COLUMN_Z.entries()) {
	box(`workshop-column-l${i}`, `Column Left ${i + 1}`, 'workshop-structure', [LEFT * W, T / 2, z], [0.7, T, 0.7], COLORS.steel);
	box(`workshop-column-r${i}`, `Column Right ${i + 1}`, 'workshop-structure', [RIGHT * W, T / 2, z], [0.7, T, 0.7], COLORS.steel);
	// A roof truss across the hall over every pair of columns; the roof itself is left open to the sky.
	box(`workshop-truss-${i}`, `Roof Truss ${i + 1}`, 'workshop-structure', [0, T + 0.25, z], [2 * W + 0.8, 0.5, 0.35], COLORS.roof, true);
}
for (const [i, x] of COLUMN_X.entries()) {
	box(`workshop-column-b${i}`, `Column Back ${i + 1}`, 'workshop-structure', [x, T / 2, B], [0.7, T, 0.7], COLORS.steel);
	box(`workshop-column-f${i}`, `Column Entrance ${i + 1}`, 'workshop-structure', [x, T / 2, F], [0.7, T, 0.7], COLORS.steel);
	box(`workshop-purlin-${i}`, `Roof Purlin ${i + 1}`, 'workshop-structure', [x, T + 0.65, midZ], [0.3, 0.3, length + 0.8], COLORS.roof, true);
}

group('workshop-lighting', 'Lamps', 'workshop-building');
for (const [i, [x, z]] of [[-4, -6], [4, -6], [-4, -14], [4, -14], [-4, -22], [4, -22]].entries()) {
	const shadeY = 5.1;
	slot(`workshop-lamp-${i}-cord`, `Lamp ${i + 1} Cord`, 'workshop-lighting', { position: [x, (T + shadeY) / 2, z], scale: [0.03, T - shadeY, 0.03], components: [mesh('cylinder', COLORS.cord)] });
	slot(`workshop-lamp-${i}`, `Lamp ${i + 1}`, 'workshop-lighting', { position: [x, shadeY, z], scale: [0.9, 0.25, 0.9], components: [mesh('cylinder', COLORS.lampShade)] });
}

// --- The entrance ---------------------------------------------------------------------------------------------------
group('workshop-entrance', 'Entrance');
const padZ = 1.5;
slot('workshop-pad-outer', 'Arrival Pad Ring', 'workshop-entrance', { position: [0, 0.015, padZ], scale: [3.2, 0.03, 3.2], components: [mesh('cylinder', COLORS.safety)] });
slot('workshop-pad-mid', 'Arrival Pad', 'workshop-entrance', { position: [0, 0.02, padZ], scale: [2.9, 0.04, 2.9], components: [mesh('cylinder', '#1f2937')] });
slot('workshop-pad-core', 'Arrival Pad Center', 'workshop-entrance', { position: [0, 0.025, padZ], scale: [0.8, 0.05, 0.8], components: [mesh('cylinder', COLORS.safety)] });

function standingSign(id, x, z, text) {
	const y = 1.75;
	sign(id, 'workshop-entrance', [x, y, z], [1.6, 1.2], '+z', text, '#111827');
	for (const [suffix, dx] of [['l', -0.7], ['r', 0.7]]) {
		slot(`${id}-leg-${suffix}`, `${text.title} Sign Leg`, 'workshop-entrance', { position: [x + dx, (y - 0.66) / 2, z - 0.03], scale: [0.07, y - 0.66, 0.07], components: [mesh('cylinder', COLORS.steel), solid] });
	}
}
standingSign('workshop-welcome', LEFT * 3.4, -1.2, { title: 'Workshop', lines: ['A place to build in VR.', 'Each bay holds the tools', 'for one kind of work.', 'Build big on the floor ahead.'] });
standingSign('workshop-tool-basics', LEFT * 5.4, -1.2, TOOL_BASICS);
standingSign('workshop-directory', RIGHT * 3.4, -1.2, {
	title: 'Directory',
	lines: [
		'Left: ' + BAYS.filter((bay) => bay.side === LEFT).map((bay) => bay.title).join(', '),
		'Right: ' + BAYS.filter((bay) => bay.side === RIGHT).map((bay) => bay.title).join(', '),
		'Ahead: Build Floor',
		'At the back: Showcase Stage'
	]
});
box('workshop-mirror-frame', 'Mirror Frame', 'workshop-entrance', [LEFT * 5, 1.3, F - inner - 0.03], [1.6, 2.4, 0.06], '#111827', true);
slot('workshop-mirror', 'Mirror', 'workshop-entrance', { position: [LEFT * 5, 1.3, F - inner - 0.065], scale: [1.44, 2.24, 1], components: [mesh('plane'), { type: 'mirror', resolution: 1024 }] });

// --- The work bays --------------------------------------------------------------------------------------------------
const BAY_DEPTH = 5.8; // from the wall's inner face into the hall
for (const bay of BAYS) {
	const g = `workshop-bay-${bay.id}`;
	group(g, `Bay: ${bay.title}`);
	const s = bay.side; // which wall: LEFT (+X) or RIGHT (-X)
	const zNear = COLUMN_Z[bay.index + 1], zFar = COLUMN_Z[bay.index + 2];
	const mid = (zNear + zFar) / 2;
	const wallFace = s * (W - t / 2); // x of the wall's inner face
	const inward = -s; // towards the middle of the hall
	const at = (fromWall) => wallFace + inward * fromWall; // x at a distance from the wall
	const facing = s < 0 ? '+x' : '-x';

	// The bay's own floor, in a dark shade of its colour, edged in its colour along the aisle.
	box(`${g}-floor`, `${bay.title} Bay Floor`, g, [at(BAY_DEPTH / 2), 0.006, mid], [BAY_DEPTH, 0.01, zNear - zFar - 0.8], shade(bay.color, 0.3), true);
	box(`${g}-edge`, `${bay.title} Bay Edge`, g, [at(BAY_DEPTH), 0.009, mid], [0.12, 0.012, zNear - zFar - 0.8], bay.color, true);

	// Workbench against the wall, the pegboard above it for hanging tools, and shelving beside it.
	const benchZ = mid + 1, benchLength = 4, benchDepth = 0.9, benchHeight = 0.9;
	box(`${g}-pegboard`, `${bay.title} Pegboard`, g, [at(0.03), 1.8, benchZ], [0.05, 1.6, benchLength], COLORS.pegboard, true);
	box(`${g}-bench-top`, `${bay.title} Workbench Top`, g, [at(benchDepth / 2 + 0.05), benchHeight - 0.03, benchZ], [benchDepth, 0.06, benchLength], COLORS.benchTop);
	for (const [suffix, dz] of [['a', -1], ['b', 1]]) {
		box(`${g}-bench-side-${suffix}`, `${bay.title} Workbench Side`, g, [at(benchDepth / 2 + 0.05), (benchHeight - 0.06) / 2, benchZ + dz * (benchLength / 2 - 0.05)], [benchDepth - 0.1, benchHeight - 0.06, 0.06], COLORS.benchFrame);
	}
	box(`${g}-bench-shelf`, `${bay.title} Workbench Lower Shelf`, g, [at(benchDepth / 2 + 0.05), 0.25, benchZ], [benchDepth - 0.1, 0.04, benchLength - 0.16], COLORS.benchFrame, true);

	const rackZ = mid - 2.2, rackWidth = 1.6, rackDepth = 0.5, rackHeight = 2.2;
	for (const [suffix, dz] of [['a', -1], ['b', 1]]) {
		box(`${g}-rack-side-${suffix}`, `${bay.title} Shelving Upright`, g, [at(rackDepth / 2), rackHeight / 2, rackZ + dz * (rackWidth / 2 - 0.025)], [rackDepth, rackHeight, 0.05], COLORS.steel);
	}
	for (const [i, y] of [0.4, 1.1, 1.8].entries()) {
		box(`${g}-rack-shelf-${i}`, `${bay.title} Shelf ${i + 1}`, g, [at(rackDepth / 2), y, rackZ], [rackDepth, 0.04, rackWidth - 0.1], COLORS.shelf, true);
	}

	sign(`${g}-sign`, g, [at(0.05), 3.25, benchZ], [1.6, 1.2], facing, { title: bay.title, lines: bay.lines }, bay.color);

	// The bay's tools, lying along the bench, each with a card on the pegboard above saying how it is used.
	const tools = TOOLS.filter((tool) => tool.bay === bay.id);
	for (const [i, tool] of tools.entries()) {
		const z = benchZ + (i - (tools.length - 1) / 2) * 1.25;
		const id = `workshop-tool-${tool.id}`;
		slot(id, tool.name, g, {
			position: [at(benchDepth / 2), benchHeight + 0.025, z],
			components: [{ type: 'container' }, { type: 'grabbable', scalable: false }, toolEquippable(), { type: 'codeBlock', code: tool.code }]
		});
		for (const [j, piece] of tool.parts.entries()) {
			slot(`${id}-part-${j}`, piece.name, id, {
				position: piece.position,
				rotation: piece.rotation,
				scale: piece.scale,
				components: [
					...(piece.mesh ? [mesh(piece.mesh, piece.color)] : []),
					...(piece.collider ? [solid] : []),
					...(piece.textDisplay ? [{ type: 'textDisplay', ...piece.textDisplay }] : [])
				]
			});
		}
		sign(`${id}-tip`, g, [at(0.08), 1.5, z], [1, 0.75], facing, tool.tip, bay.color);
	}
}
// Low partitions between neighbouring bays, out from the columns that separate them.
for (const s of [-1, 1]) {
	for (const [i, z] of [COLUMN_Z[2], COLUMN_Z[3]].entries()) {
		const length = 3.8;
		box(`workshop-partition-${s === LEFT ? 'l' : 'r'}${i}`, `Bay Partition ${s === LEFT ? 'Left' : 'Right'} ${i + 1}`, 'workshop-building', [s * (W - t / 2 - length / 2), 0.7, z], [length, 1.4, 0.1], COLORS.wainscot);
	}
}

// --- The build floor ------------------------------------------------------------------------------------------------
group('workshop-build-floor', 'Build Floor');
const BUILD = { x: [-7, 7], z: [-24, -4] };
const buildCenter = [(BUILD.x[0] + BUILD.x[1]) / 2, (BUILD.z[0] + BUILD.z[1]) / 2];
const buildSize = [BUILD.x[1] - BUILD.x[0], BUILD.z[1] - BUILD.z[0]];
box('workshop-build-surface', 'Build Floor Surface', 'workshop-build-floor', [buildCenter[0], 0.006, buildCenter[1]], [buildSize[0], 0.01, buildSize[1]], COLORS.buildFloor, true);
// A 2 m grid to size things against, inside a safety-yellow border.
for (let x = BUILD.x[0] + 2; x < BUILD.x[1]; x += 2) {
	box(`workshop-grid-x${x}`, `Grid Line X ${x}`, 'workshop-build-floor', [x, 0.013, buildCenter[1]], [0.03, 0.004, buildSize[1]], COLORS.gridLine, true);
}
for (let z = BUILD.z[0] + 2; z < BUILD.z[1]; z += 2) {
	box(`workshop-grid-z${-z}`, `Grid Line Z ${z}`, 'workshop-build-floor', [buildCenter[0], 0.013, z], [buildSize[0], 0.004, 0.03], COLORS.gridLine, true);
}
for (const [id, center, size] of [
	['n', [buildCenter[0], 0.014, BUILD.z[1]], [buildSize[0] + 0.1, 0.006, 0.1]],
	['s', [buildCenter[0], 0.014, BUILD.z[0]], [buildSize[0] + 0.1, 0.006, 0.1]],
	['w', [BUILD.x[0], 0.014, buildCenter[1]], [0.1, 0.006, buildSize[1] + 0.1]],
	['e', [BUILD.x[1], 0.014, buildCenter[1]], [0.1, 0.006, buildSize[1] + 0.1]]
]) {
	box(`workshop-build-border-${id}`, 'Build Floor Border', 'workshop-build-floor', center, size, COLORS.safety, true);
}

// --- The showcase stage ---------------------------------------------------------------------------------------------
group('workshop-stage', 'Showcase Stage');
const STAGE = { x: [-7, 7], z: [B + t / 2, -27], height: 0.3, step: 0.6 };
const stageCenterZ = (STAGE.z[0] + STAGE.z[1]) / 2;
const stageWidth = STAGE.x[1] - STAGE.x[0];
// The boxes are only the look; the ground on top is what is stood on, low enough to step up onto.
box('workshop-stage-body', 'Stage', 'workshop-stage', [0, STAGE.height / 2, stageCenterZ], [stageWidth, STAGE.height, STAGE.z[1] - STAGE.z[0]], COLORS.stage, true);
floor('workshop-stage-floor', 'Stage Floor', 'workshop-stage', STAGE.x, STAGE.z, STAGE.height + 0.001, COLORS.stageTop);
box('workshop-stage-step', 'Stage Step', 'workshop-stage', [0, STAGE.height / 4, STAGE.z[1] + STAGE.step / 2], [stageWidth, STAGE.height / 2, STAGE.step], COLORS.stage, true);
floor('workshop-stage-step-floor', 'Stage Step Floor', 'workshop-stage', STAGE.x, [STAGE.z[1], STAGE.z[1] + STAGE.step], STAGE.height / 2 + 0.001, COLORS.stageTop);
box('workshop-stage-trim', 'Stage Edge', 'workshop-stage', [0, STAGE.height + 0.004, STAGE.z[1] - 0.04], [stageWidth, 0.008, 0.08], COLORS.safety, true);
for (const [i, x] of [-4, 0, 4].entries()) {
	slot(`workshop-plinth-${i}`, `Display Plinth ${i + 1}`, 'workshop-stage', { position: [x, STAGE.height + 0.5, stageCenterZ - 0.5], scale: [0.8, 1, 0.8], components: [mesh('cylinder', COLORS.plinth), solid] });
}
sign('workshop-stage-sign', 'workshop-stage', [0, 2.9, B + inner + 0.03], [2.6, 2], '+z', { title: 'Showcase', lines: ['Put what you made on show'] }, COLORS.safety);

/** A colour mixed towards black: `amount` of the colour is kept. */
function shade(hex, amount) {
	const n = parseInt(hex.slice(1), 16);
	const channel = (shift) => Math.round(((n >> shift) & 255) * amount + 0x1a * (1 - amount));
	return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/xr/templates/workshop.json');
writeFileSync(out, JSON.stringify(slots, null, '\t') + '\n');
console.log(`Wrote ${slots.length} slots to ${out}`);
