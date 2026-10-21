import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { DOOR, HALL, ID, LEVEL_UNLOCKS, LOBBY, UI } from './bistroData.ts';
import type { Vec3 } from './bistroData.ts';
import { ALONG_X, ALONG_Z, COLOR, INK, MUTED, button, frame, loose, part, row, screen, sign, text, ui, yaw } from './bistroLook.ts';

const { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1, height: H } = LOBBY;
const T = 0.3;
const MID_Z = (Z0 + Z1) / 2;
const WIDTH = X1 - X0, DEPTH = Z1 - Z0;
const DADO = 1.0;

const lamp = (id: string, at: Vec3, color: string, intensity: number, range: number): Slot =>
	createSlot({ id, name: 'Light', position: at, components: [{ type: 'pointLight', color, intensity, range, baked: true }] });

/** The room: planks, plaster over dark panelling, and red brick on the wall the kitchen is behind. */
function shell(): Slot[] {
	const wall = (id: string, name: string, at: Vec3, scale: Vec3) => part(id, name, 'box', at, scale, COLOR.plaster, { solid: true, material: 'plaster' });
	const brick = (id: string, at: Vec3, scale: Vec3) => part(id, 'Brick Wall', 'box', at, scale, COLOR.terracotta, { material: 'brick' });
	const dado = (id: string, at: Vec3, scale: Vec3) => part(`bi-l-dado-${id}`, 'Panelling', 'box', at, scale, COLOR.walnut);
	const cap = (id: string, at: Vec3, scale: Vec3) => part(`bi-l-cap-${id}`, 'Dado Rail', 'box', at, scale, COLOR.oak);
	const half = DOOR.half;
	const side = X1 - half - 0.1;
	const slots: Slot[] = [
		createSlot({ id: 'bi-sky', name: 'Sky', components: [{ type: 'skybox', topColor: '#6fb7f0', horizonColor: '#e3f1fb', bottomColor: '#cfe3d0', stars: 0, ambientIntensity: 0.9 }] }),
		createSlot({ id: 'bi-spawn', name: 'Spawn Point', position: [0, 0, Z0 + 1.5], components: [{ type: 'spawnPoint' }] }),
		part('bi-l-floor', 'Lobby Floor', 'ground', [0, 0, MID_Z], [WIDTH / 20, 1, DEPTH / 20], COLOR.oak, { solid: true, material: 'planks' }),
		part('bi-l-ceiling', 'Lobby Ceiling', 'box', [0, H + 0.1, MID_Z], [WIDTH + 2 * T, 0.2, DEPTH + T], COLOR.cream),
		wall('bi-l-wall-w', 'West Wall', [X0 - T / 2, H / 2, MID_Z], [T, H, DEPTH + T]),
		wall('bi-l-wall-e', 'East Wall', [X1 + T / 2, H / 2, MID_Z], [T, H, DEPTH + T]),
		wall('bi-l-wall-s', 'South Wall', [0, H / 2, Z0 - T / 2], [WIDTH + 2 * T, H, T]),
		// Brick over the wall to the kitchen, on this side of it.
		brick('bi-l-brick-l', [-(half + 0.1 + side / 2), H / 2, Z1 - 0.03], [side, H, 0.06]),
		brick('bi-l-brick-r', [half + 0.1 + side / 2, H / 2, Z1 - 0.03], [side, H, 0.06]),
		brick('bi-l-brick-t', [0, (DOOR.height + H) / 2, Z1 - 0.03], [2 * half + 0.2, H - DOOR.height, 0.06]),
		dado('w', [X0 + 0.025, DADO / 2, MID_Z], [0.05, DADO, DEPTH]),
		dado('e', [X1 - 0.025, DADO / 2, MID_Z], [0.05, DADO, DEPTH]),
		dado('s', [0, DADO / 2, Z0 + 0.025], [WIDTH, DADO, 0.05]),
		cap('w', [X0 + 0.04, DADO + 0.025, MID_Z], [0.08, 0.05, DEPTH]),
		cap('e', [X1 - 0.04, DADO + 0.025, MID_Z], [0.08, 0.05, DEPTH]),
		cap('s', [0, DADO + 0.025, Z0 + 0.04], [WIDTH, 0.05, 0.08]),
		// A skirting along the brick.
		part('bi-l-skirt-l', 'Skirting', 'box', [-(half + 0.1 + side / 2), 0.09, Z1 - 0.075], [side, 0.18, 0.03], COLOR.walnut),
		part('bi-l-skirt-r', 'Skirting', 'box', [half + 0.1 + side / 2, 0.09, Z1 - 0.075], [side, 0.18, 0.03], COLOR.walnut)
	];
	for (const z of [-3.2, -6.8]) slots.push(part(`bi-l-beam-${z}`, 'Ceiling Beam', 'box', [0, H - 0.1, z], [WIDTH, 0.2, 0.22], COLOR.walnut));
	return slots;
}

/** A lamp on a cord with a brass shade. */
function pendant(id: string, x: number, z: number): Slot[] {
	const y = 2.25;
	return [
		part(`${id}-cord`, 'Lamp Cord', 'cylinder', [x, (y + 0.14 + H) / 2, z], [0.016, H - y - 0.14, 0.016], COLOR.iron),
		part(`${id}-shade`, 'Lamp Shade', 'cylinder', [x, y + 0.07, z], [0.5, 0.14, 0.5], COLOR.brass),
		part(`${id}-cap`, 'Lamp Shade', 'cylinder', [x, y + 0.17, z], [0.22, 0.08, 0.22], COLOR.oakDark),
		part(`${id}-bulb`, 'Bulb', 'sphere', [x, y - 0.03, z], [0.14, 0.14, 0.14], COLOR.lampWarm, { unlit: true }),
		lamp(`${id}-light`, [x, y - 0.25, z], '#ffdcb0', 1.15, 6.5)
	];
}

/** A plant in a terracotta pot. */
function plant(id: string, x: number, z: number, tall = 1): Slot[] {
	return loose(id, 'Plant', [
		['pot', 'cylinder', [x, 0.24, z], [0.46, 0.48, 0.46], COLOR.terracotta],
		['rim', 'cylinder', [x, 0.5, z], [0.52, 0.06, 0.52], '#9c4f2e'],
		['trunk', 'cylinder', [x, 0.5 + 0.3 * tall, z], [0.06, 0.6 * tall, 0.06], COLOR.oakDark],
		['leaves-a', 'sphere', [x, 0.75 + 0.6 * tall, z], [0.8, 0.7, 0.8], COLOR.leaf],
		['leaves-b', 'sphere', [x + 0.2, 1.0 + 0.6 * tall, z + 0.1], [0.5, 0.5, 0.5], COLOR.leafLight],
		['leaves-c', 'sphere', [x - 0.22, 0.95 + 0.6 * tall, z - 0.12], [0.46, 0.44, 0.46], '#2f7a34']
	]);
}

/** What makes it a staff room: lockers and a bench, a coat rack with chef's hats, a rug, plants, lamps, and the big sign over the door. */
function furniture(): Slot[] {
	const slots: Slot[] = [];
	// The sign over the kitchen door, with a brass lamp each side of the door.
	slots.push(sign('bi-l-title', [0, 2.78, Z1 - 0.07], Math.PI, 2.6, 0.62, 'BISTRO RUSH', [], 2.2, '#7f1d1d'), ...frame('bi-l-title-frame', [0, 2.78, Z1 - 0.08], 'x', 2.6, 0.62, COLOR.brass));
	for (const x of [-1.5, 1.5]) {
		slots.push(
			part(`bi-l-sconce-${x}-arm`, 'Wall Lamp', 'box', [x, 2.05, Z1 - 0.14], [0.04, 0.04, 0.18], COLOR.brass),
			part(`bi-l-sconce-${x}-shade`, 'Wall Lamp', 'cylinder', [x, 2.02, Z1 - 0.24], [0.2, 0.18, 0.2], COLOR.brass),
			part(`bi-l-sconce-${x}-bulb`, 'Bulb', 'sphere', [x, 1.94, Z1 - 0.24], [0.11, 0.11, 0.11], COLOR.lampWarm, { unlit: true }),
			lamp(`bi-l-sconce-${x}-light`, [x, 1.8, Z1 - 0.45], '#ffcf96', 0.55, 3.6)
		);
	}
	for (const [x, z] of [[-3, -3], [3, -3], [-3, -7], [3, -7]]) slots.push(...pendant(`bi-l-pend-${x}${z}`, x, z));

	// A round rug in the middle of the room.
	slots.push(part('bi-l-rug', 'Rug', 'cylinder', [0, 0.006, -5], [4.4, 0.012, 4.4], COLOR.red), part('bi-l-rug-in', 'Rug', 'cylinder', [0, 0.01, -5], [3.7, 0.012, 3.7], '#e9dcc0'), part('bi-l-rug-mid', 'Rug', 'cylinder', [0, 0.014, -5], [1.5, 0.012, 1.5], COLOR.green));

	// Lockers along the south wall, west of where the players arrive, with a bench in front.
	for (let i = 0; i < 5; i++) {
		const x = -5.55 + i * 0.56;
		const z = Z0 + 0.3;
		slots.push(
			part(`bi-l-locker-${i}`, 'Locker', 'box', [x, 0.95, z], [0.54, 1.9, 0.5], i % 2 ? '#3e7c8a' : '#4a8f9e', { solid: true }),
			part(`bi-l-locker-${i}-vent`, 'Locker', 'box', [x, 1.6, z + 0.255], [0.34, 0.14, 0.01], COLOR.slate),
			part(`bi-l-locker-${i}-handle`, 'Locker', 'box', [x + 0.17, 1.05, z + 0.265], [0.03, 0.14, 0.03], COLOR.steel)
		);
	}
	slots.push(...loose('bi-l-bench', 'Bench', [
		['seat', 'box', [-4.4, 0.45, Z0 + 1.25], [2.4, 0.07, 0.45], COLOR.oak, { solid: true }],
		['leg-a', 'box', [-5.4, 0.21, Z0 + 1.25], [0.07, 0.42, 0.4], COLOR.iron],
		['leg-b', 'box', [-3.4, 0.21, Z0 + 1.25], [0.07, 0.42, 0.4], COLOR.iron]
	]));

	// A coat rack with three chef's hats and an apron, east of the way in.
	const rackX = 4.3, rackZ = Z0 + 0.09;
	slots.push(part('bi-l-rack', 'Coat Rack', 'box', [rackX, 1.75, rackZ], [2.2, 0.12, 0.04], COLOR.walnut));
	for (let i = 0; i < 4; i++) {
		const x = rackX - 0.84 + i * 0.56;
		slots.push(part(`bi-l-peg-${i}`, 'Peg', 'cylinder', [x, 1.75, rackZ + 0.08], [0.035, 0.14, 0.035], COLOR.brass, { rotation: ALONG_Z }));
		if (i < 3) {
			slots.push(
				part(`bi-l-hat-${i}-band`, "Chef's Hat", 'cylinder', [x, 1.9, rackZ + 0.16], [0.24, 0.12, 0.24], COLOR.white),
				part(`bi-l-hat-${i}-top`, "Chef's Hat", 'sphere', [x, 2.04, rackZ + 0.16], [0.32, 0.24, 0.32], COLOR.white)
			);
		} else {
			slots.push(part('bi-l-apron', 'Apron', 'box', [x, 1.28, rackZ + 0.1], [0.4, 0.8, 0.03], COLOR.red), part('bi-l-apron-pocket', 'Apron', 'box', [x, 1.1, rackZ + 0.12], [0.24, 0.16, 0.02], '#8f1d17'));
		}
	}

	// A crate of vegetables and a few sacks by the kitchen door: the morning's delivery.
	slots.push(...loose('bi-l-delivery', 'Delivery', [
		['crate', 'box', [1.75, 0.2, Z1 - 0.55], [0.7, 0.4, 0.5], COLOR.oak, { solid: true }],
		['slat', 'box', [1.75, 0.3, Z1 - 0.805], [0.7, 0.06, 0.02], COLOR.oakDark],
		['veg-a', 'sphere', [1.58, 0.45, Z1 - 0.6], [0.2, 0.18, 0.2], '#4d9a2a'],
		['veg-b', 'sphere', [1.8, 0.46, Z1 - 0.5], [0.18, 0.18, 0.18], '#dc2626'],
		['veg-c', 'sphere', [1.95, 0.44, Z1 - 0.66], [0.16, 0.16, 0.16], '#dc2626'],
		['sack', 'cylinder', [-1.7, 0.3, Z1 - 0.5], [0.46, 0.6, 0.46], '#c8b089'],
		['sack-top', 'sphere', [-1.7, 0.6, Z1 - 0.5], [0.4, 0.22, 0.4], '#b89f76'],
		['sack-b', 'cylinder', [-2.15, 0.22, Z1 - 0.62], [0.5, 0.44, 0.5], '#bfa67c', { rotation: ALONG_X }]
	]));

	slots.push(...plant('bi-l-plant-nw', X0 + 0.55, Z1 - 0.6, 1.2), ...plant('bi-l-plant-ne', X1 - 0.55, Z1 - 0.6, 1.2), ...plant('bi-l-plant-se', X1 - 0.55, Z0 + 0.6, 0.9));
	return slots;
}

/** The lobby's screens: your restaurant (with its plan), the chef card, the franchise track, the two boards and how to play. */
function screens(): Slot[] {
	const root = ID.root;
	const slots: Slot[] = [];
	const zWall = Z1 - 0.075;

	// Your restaurant, left of the door.
	const sx = -3.45, sy = 1.62;
	slots.push(screen(UI.setup, root, 'Your Restaurant', [sx, sy, zWall], Math.PI, 880, 800, 1.9), ...frame('bi-setup-frame', [sx, sy, zWall + 0.02], 'x', 1.9, 1.9 * (800 / 880)));
	slots.push(text('bi-setup-title', UI.setup, 'YOUR RESTAURANT', 840, 60, 42, COLOR.gold, 'center', true), text(UI.setupStatus, UI.setup, '', 840, 66, 22, INK, 'center'));
	const picker = (key: string, prev: string, label: string, next: string) => {
		const r = `bi-setup-${key}-row`;
		slots.push(row(r, UI.setup, 840, 62, 10, { margin: 2 }), button(prev, r, '<', 80, 58, '#57534e', 30), text(label, r, '', 650, 58, 25, INK, 'center', true), button(next, r, '>', 80, 58, '#57534e', 30));
	};
	picker('seed', UI.seedPrev, UI.setupSeed, UI.seedNext);
	picker('size', UI.sizePrev, UI.setupSize, UI.sizeNext);
	picker('dish', UI.dishPrev, UI.setupDish, UI.dishNext);
	// The plan of the restaurant: one square per cell, the street at the top.
	slots.push(ui('bi-plan', UI.setup, 'container', { width: 360, height: 292, flexDirection: 'column', gap: 2, padding: 6, background: '#0d0b09', cornerRadius: 8, margin: 4 }));
	for (let gz = HALL.d - 1; gz >= 0; gz--) {
		slots.push(row(UI.planRow(gz), 'bi-plan', 340, 32, 2));
		for (let gx = 0; gx < HALL.w; gx++) slots.push(ui(UI.planCell(gx, gz), UI.planRow(gz), 'container', { width: 32, height: 32, background: '#2a241d', cornerRadius: 4 }));
	}
	slots.push(row('bi-setup-go', UI.setup, 840, 84, 14, { margin: 4 }), button(UI.start, 'bi-setup-go', 'NEW RESTAURANT', 413, 80, '#15803d', 28), button(UI.resume, 'bi-setup-go', 'CONTINUE', 413, 80, '#1d4ed8', 28));

	// The chef card, right of the door.
	const cx = 3.45;
	slots.push(screen(UI.card, root, 'Chef Card', [cx, sy, zWall], Math.PI, 700, 640, 1.6), ...frame('bi-card-frame', [cx, sy, zWall + 0.02], 'x', 1.6, 1.6 * (640 / 700)));
	slots.push(text('bi-card-title', UI.card, 'CHEF CARD', 660, 64, 42, COLOR.gold, 'center', true));
	for (let i = 0; i < UI.cardLines; i++) slots.push(text(UI.cardLine(i), UI.card, '', 660, i === 0 ? 62 : 58, i === 0 ? 34 : 25, i < 2 ? INK : '#e7dcc6', i === 0 ? 'center' : 'left', i < 3));

	// The franchise track, on the west wall: read from the east.
	slots.push(screen(UI.track, root, 'Franchise', [X0 + 0.075, 1.72, -3.3], Math.PI / 2, 760, 720, 1.8), ...frame('bi-track-frame', [X0 + 0.05, 1.72, -3.3], 'z', 1.8, 1.8 * (720 / 760)));
	slots.push(text('bi-track-title', UI.track, 'FRANCHISE', 720, 62, 42, COLOR.gold, 'center', true), text('bi-track-sub', UI.track, 'Every day a restaurant survives is experience for its cooks.', 720, 40, 20, MUTED, 'center'));
	LEVEL_UNLOCKS.forEach((_, i) => slots.push(text(UI.trackLine(i), UI.track, '', 720, 72, 23, INK, 'left', true)));

	// How to play, further along the same wall.
	slots.push(
		sign('bi-l-howto', [X0 + 0.07, 1.75, -6.9], Math.PI / 2, 2.2, 1.5, 'HOW TO PLAY', [
			'Take ingredients from the crates.',
			'Chop them with the knife, cook them on the hob.',
			'Put what a guest ordered on a plate',
			'and the plate on their table.',
			'Wash the dirty plates. Lose three guests and it is over.',
			'Between days: buy blueprints and move your kitchen.'
		], 0.82, '#1c2a23'),
		...frame('bi-l-howto-frame', [X0 + 0.05, 1.75, -6.9], 'z', 2.2, 1.5, COLOR.oak)
	);

	// The boards, on the east wall: read from the west.
	for (const [id, title, z] of [[UI.boardDay, 'Longest runs (days)', -3.2], [UI.boardServed, 'Dishes served', -6.6]] as const) {
		slots.push(
			createSlot({
				id,
				name: `${title} Board`,
				position: [X1 - 0.07, 1.75, z],
				// Read from the west: its face looks along -x.
				rotation: yaw(Math.PI / 2),
				scale: [1.9, 1.1, 1],
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' }, { type: 'scoreboard', title, status: '', columns: ['Score'], rows: [] }]
			}),
			...frame(`${id}-frame`, [X1 - 0.05, 1.75, z], 'z', 1.9, 1.1, COLOR.brass)
		);
	}

	// The way back to the main lobby, on the south wall beside the lockers.
	const link = screen('bi-lobby-link', root, 'Back to the Lobby', [1.6, 1.5, Z0 + 0.075], 0, 420, 150, 1.0, '#1c2a23');
	link.components.push({ type: 'worldLink', target: { kind: 'builtin', id: 'lobby' }, label: 'Lobby' });
	slots.push(link, text('bi-lobby-link-text', 'bi-lobby-link', 'BACK TO THE LOBBY', 400, 130, 34, COLOR.gold, 'center', true), ...frame('bi-lobby-link-frame', [1.6, 1.5, Z0 + 0.05], 'x', 1.0, 1.0 * (150 / 420), COLOR.oak));
	return slots;
}

/** The back room every player arrives in: where a restaurant is chosen, and where a chef sees how far they have come. */
export function buildLobby(): Slot[] {
	return [...shell(), ...furniture(), ...screens()];
}
