import type { Quat, Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import type { Vec3 } from './arcadeKit.ts';
import { mesh } from './deadDropKit.ts';
import { COLOR, FURNITURE, MATERIAL, composite, yawOf } from './deadDropLook.ts';

/** The bunker's walls, as `deadDropHub.ts` lays them out: x from -10 to 10, z from -4 to 12, 4 m high. */
const X0 = -10, X1 = 10, Z0 = -4, Z1 = 12, H = 4;

const quarter = Math.PI / 4;
/** A cylinder lies along x. */
const alongX: Quat = [0, 0, Math.sin(quarter), Math.cos(quarter)];
/** A cylinder lies along z. */
const alongZ: Quat = [Math.sin(quarter), 0, 0, Math.cos(quarter)];

const STEEL = '#4a4f57';
const DARK = '#25272b';
const SAFETY_RED = '#b3271f';

/** A sign on a wall: dark, with text. `looks` is the direction the readable face looks towards, as a yaw (0 looks along +z, so a sign read from the south looks towards -z: PI). */
export function sign(id: string, at: Vec3, looks: number, width: number, height: number, title: string, lines: string[], scale: number): Slot {
	return createSlot({
		id,
		name: title || 'Sign',
		position: at,
		// A plane is read from its -z side.
		rotation: yawOf(looks + Math.PI),
		scale: [width, height, 1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0c0a09' },
			{ type: 'textDisplay', title, lines, color: '#0c0a09', scale, verticalAlign: 'middle' }
		]
	});
}

/** The lamps that give the bunker its light: where they hang, what colour they give and how far. The lamp fixtures are drawn at the first four. */
export const BUNKER_LIGHTS: { id: string; at: Vec3; color: string; intensity: number; range: number }[] = [
	// The four ceiling lamps: two work, two are dead, so that the room has a bright place and a lot of dark.
	{ id: 'dd-light-0', at: [-5, 3.5, 3], color: '#ffd9a0', intensity: 3.4, range: 6.5 },
	{ id: 'dd-light-1', at: [5, 3.5, 3], color: '#ffe8c0', intensity: 0, range: 5 },
	{ id: 'dd-light-2', at: [-5, 3.5, 9], color: '#ffd9a0', intensity: 0, range: 5 },
	{ id: 'dd-light-3', at: [5, 3.5, 9], color: '#ffe8c0', intensity: 2.9, range: 6.5 },
	// Over the way in: a cold, weak light.
	{ id: 'dd-light-door', at: [0, 3.2, -2.4], color: '#cfe3ff', intensity: 1.3, range: 5.5 },
	// Over the armory: the one hard working light, because that is where the squad has to see.
	{ id: 'dd-light-armory', at: [0, 2.5, 5.2], color: '#fff1d6', intensity: 3.2, range: 5.2 },
	// Over the map table: the blue of the map, low.
	{ id: 'dd-light-map', at: [0, 2.8, 10.2], color: '#9fd0ff', intensity: 1.4, range: 4.5 },
	// A bare bulb over the lockers.
	{ id: 'dd-light-stash', at: [-8.2, 2.95, 3.7], color: '#ffd59a', intensity: 1.9, range: 4.8 },
	// Wall lamps with a cage in the two dark corners at the back, weak and warm.
	{ id: 'dd-light-sconce-w', at: [-9.0, 2.7, 9.6], color: '#ffcf8a', intensity: 1.4, range: 5.2 },
	{ id: 'dd-light-sconce-n', at: [-6.2, 2.9, 11.1], color: '#ffcf8a', intensity: 1.2, range: 5 },
	// The trader's lantern, and the gate's warning light.
	{ id: 'dd-light-trader', at: [8.2, 2.5, 8], color: '#ffb347', intensity: 2.0, range: 4.5 },
	{ id: 'dd-light-gate', at: [8.9, 2.9, 1.8], color: '#ff6a3d', intensity: 1.3, range: 4.2 },
	// Emergency lights in two corners.
	{ id: 'dd-light-em-0', at: [-9.2, 3.5, -3.2], color: '#ff3b2f', intensity: 0.9, range: 4 },
	{ id: 'dd-light-em-1', at: [9.2, 3.5, 11.2], color: '#ff3b2f', intensity: 0.9, range: 4 }
];

/** The structure of the room: ribs across the ceiling, pilasters along the walls, a steel dado, and a blast door to arrive through. */
function structure(): Slot[] {
	const slots: Slot[] = [];
	const width = X1 - X0, depth = Z1 - Z0;
	const midX = (X0 + X1) / 2, midZ = (Z0 + Z1) / 2;
	// Ribs across the ceiling.
	for (const z of [0, 6]) {
		slots.push(mesh(`dd-bk-rib-${z}`, 'Ceiling Rib', 'box', [midX, H - 0.2, z], [width, 0.4, 0.6], '#8a867e', { material: MATERIAL.wall }));
	}
	// Pilasters: thick piers on the walls, which take the ribs and cast the deep shadows a flat wall never does.
	const pier = (id: string, x: number, z: number, alongWall: 'x' | 'z') =>
		mesh(`dd-bk-pier-${id}`, 'Pilaster', 'box', [x, H / 2, z], alongWall === 'x' ? [0.6, H, 0.5] : [0.5, H, 0.6], '#8a867e', { solid: true, material: MATERIAL.wall });
	for (const x of [-8.2, -4.2, 4.2, 8.2]) slots.push(pier(`n${x}`, x, Z1 - 0.25, 'x'));
	for (const x of [-7, -3, 3, 7]) slots.push(pier(`s${x}`, x, Z0 + 0.25, 'x'));
	for (const z of [-0.9, 7.2, 10.6]) slots.push(pier(`w${z}`, X0 + 0.25, z, 'z'));
	for (const z of [-2.6, 5.0]) slots.push(pier(`e${z}`, X1 - 0.25, z, 'z'));
	// A steel dado along the walls, with a hazard stripe on top of it.
	const dado = (id: string, at: Vec3, scale: Vec3) => mesh(`dd-bk-dado-${id}`, 'Dado', 'box', at, scale, '#4b5058');
	const stripe = (id: string, at: Vec3, scale: Vec3) => mesh(`dd-bk-stripe-${id}`, 'Hazard Stripe', 'box', at, scale, COLOR.hazard);
	slots.push(
		dado('n', [midX, 0.55, Z1 - 0.04], [width, 1.1, 0.08]),
		dado('s', [midX, 0.55, Z0 + 0.04], [width, 1.1, 0.08]),
		dado('w', [X0 + 0.04, 0.55, midZ], [0.08, 1.1, depth]),
		dado('e', [X1 - 0.04, 0.55, midZ], [0.08, 1.1, depth]),
		stripe('n', [midX, 1.14, Z1 - 0.05], [width, 0.06, 0.1]),
		stripe('s', [midX, 1.14, Z0 + 0.05], [width, 0.06, 0.1]),
		stripe('w', [X0 + 0.05, 1.14, midZ], [0.1, 0.06, depth]),
		stripe('e', [X1 - 0.05, 1.14, midZ], [0.1, 0.06, depth])
	);
	// The blast door the squad came in by, behind the arrival point: painted steel with raised panels, bolts, a hazard band and a wheel.
	const dz = Z0 + 0.12;
	slots.push(
		mesh('dd-bk-door-frame-l', 'Blast Door Frame', 'box', [-1.6, 1.7, Z0 + 0.2], [0.35, 3.4, 0.4], COLOR.hazard),
		mesh('dd-bk-door-frame-r', 'Blast Door Frame', 'box', [1.6, 1.7, Z0 + 0.2], [0.35, 3.4, 0.4], COLOR.hazard),
		mesh('dd-bk-door-frame-t', 'Blast Door Frame', 'box', [0, 3.35, Z0 + 0.2], [3.55, 0.35, 0.4], COLOR.hazard),
		mesh('dd-bk-door', 'Blast Door', 'box', [0, 1.55, dz], [2.85, 3.1, 0.24], '#cfd8c6', { solid: true, material: MATERIAL.olive }),
		mesh('dd-bk-door-band', 'Hazard Band', 'box', [0, 0.32, dz + 0.14], [2.85, 0.5, 0.05], COLOR.hazard),
		mesh('dd-bk-door-band-b', 'Hazard Band', 'box', [0, 3.0, dz + 0.14], [2.85, 0.16, 0.05], COLOR.hazard),
		mesh('dd-bk-door-lamp-l', 'Door Lamp', 'sphere', [-1.25, 3.75, Z0 + 0.3], [0.22, 0.22, 0.22], COLOR.alert, { unlit: true }),
		mesh('dd-bk-door-lamp-r', 'Door Lamp', 'sphere', [1.25, 3.75, Z0 + 0.3], [0.22, 0.22, 0.22], COLOR.alert, { unlit: true }),
		// The readable face looks into the room (towards +z).
		sign('dd-bk-sign-door', [0, 2.72, dz + 0.2], 0, 2.2, 0.42, 'SECTOR 7', ['BLAST DOOR · KEEP CLOSED'], 1.9)
	);
	// Raised panels, in two columns of two.
	for (const x of [-0.7, 0.7]) {
		for (const y of [1.0, 2.0]) {
			slots.push(
				mesh(`dd-bk-door-panel-${x}-${y}`, 'Door Panel', 'box', [x, y, dz + 0.14], [1.1, 0.8, 0.04], '#8a9686', { material: MATERIAL.olive }),
				mesh(`dd-bk-door-panel-in-${x}-${y}`, 'Door Panel', 'box', [x, y, dz + 0.165], [0.9, 0.6, 0.02], '#bcc6b6', { material: MATERIAL.olive })
			);
		}
	}
	// Bolts round the edge.
	for (const x of [-1.28, 1.28]) {
		for (let i = 0; i < 6; i++) slots.push(mesh(`dd-bk-door-bolt-${x}-${i}`, 'Bolt', 'cylinder', [x, 0.7 + i * 0.4, dz + 0.14], [0.07, 0.04, 0.07], COLOR.metalDark, { rotation: alongZ }));
	}
	// The wheel: a hub, three spokes through it and a rim of twelve blocks.
	const wz = dz + 0.2;
	slots.push(mesh('dd-bk-door-hub', 'Blast Door Wheel', 'cylinder', [0, 1.5, wz], [0.26, 0.1, 0.26], COLOR.hazard, { rotation: alongZ }));
	for (const [i, angle] of [0, Math.PI / 3, (2 * Math.PI) / 3].entries()) {
		slots.push(mesh(`dd-bk-door-spoke-${i}`, 'Blast Door Wheel', 'box', [0, 1.5, wz], [0.94, 0.07, 0.06], '#2b2e33', { rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] }));
	}
	for (let i = 0; i < 12; i++) {
		const angle = (i / 12) * Math.PI * 2;
		slots.push(mesh(`dd-bk-door-rim-${i}`, 'Blast Door Wheel', 'box', [Math.cos(angle) * 0.47, 1.5 + Math.sin(angle) * 0.47, wz], [0.16, 0.08, 0.07], '#2b2e33', { rotation: [0, 0, Math.sin((angle + Math.PI / 2) / 2), Math.cos((angle + Math.PI / 2) / 2)] }));
	}
	return slots;
}

/** What hangs from the ceiling: pipe bundles, a duct, cable trays, caged lamps and vertical pipes in the corners. */
function overhead(): Slot[] {
	const slots: Slot[] = [];
	const width = X1 - X0, midX = (X0 + X1) / 2;
	const pipe = (id: string, z: number, y: number, diameter: number, color: string, material = false) =>
		mesh(`dd-bk-pipe-${id}`, 'Pipe', 'cylinder', [midX, y, z], [diameter, width - 0.4, diameter], color, { rotation: alongX, ...(material ? { material: MATERIAL.rust } : {}) });
	slots.push(
		pipe('a', 1.7, 3.55, 0.22, COLOR.metalDark),
		pipe('b', 2.15, 3.62, 0.12, COLOR.rust, true),
		pipe('c', 1.3, 3.66, 0.1, SAFETY_RED),
		pipe('d', 4.6, 3.6, 0.16, COLOR.metalDark),
		pipe('e', 4.95, 3.5, 0.1, COLOR.rust, true),
		pipe('f', 11.0, 3.55, 0.2, COLOR.metalDark),
		// A wide duct with hangers, across the room behind the armory.
		mesh('dd-bk-duct', 'Duct', 'box', [midX, 3.4, 7.7], [width - 0.4, 0.5, 0.8], STEEL, { material: MATERIAL.plate })
	);
	for (const x of [-7.5, -2.5, 2.5, 7.5]) {
		slots.push(
			mesh(`dd-bk-hanger-${x}-a`, 'Hanger', 'box', [x, 3.78, 7.35], [0.05, 0.4, 0.05], DARK),
			mesh(`dd-bk-hanger-${x}-b`, 'Hanger', 'box', [x, 3.78, 8.05], [0.05, 0.4, 0.05], DARK),
			mesh(`dd-bk-duct-band-${x}`, 'Duct Band', 'box', [x, 3.4, 7.7], [0.12, 0.56, 0.86], DARK)
		);
	}
	// Cable trays along both side walls.
	for (const [side, x] of [['w', X0 + 0.35], ['e', X1 - 0.35]] as const) {
		slots.push(
			mesh(`dd-bk-tray-${side}`, 'Cable Tray', 'box', [x, 3.3, 4], [0.34, 0.06, 15], DARK),
			mesh(`dd-bk-cables-${side}-a`, 'Cables', 'cylinder', [x - 0.08, 3.35, 4], [0.05, 15, 0.05], COLOR.black, { rotation: alongZ }),
			mesh(`dd-bk-cables-${side}-b`, 'Cables', 'cylinder', [x + 0.06, 3.35, 4], [0.04, 15, 0.04], SAFETY_RED, { rotation: alongZ })
		);
	}
	// Vertical pipes in the corners.
	for (const [i, [x, z]] of [[X0 + 0.3, Z0 + 0.3], [X1 - 0.3, Z0 + 0.3], [X0 + 0.3, Z1 - 0.3], [X1 - 0.3, Z1 - 0.3]].entries()) {
		slots.push(mesh(`dd-bk-riser-${i}`, 'Riser', 'cylinder', [x, H / 2, z], [0.22, H, 0.22], i % 2 ? COLOR.rust : COLOR.metalDark, { material: MATERIAL.rust }));
	}
	// Caged industrial lamps: the first four are where the light comes from.
	for (const [i, light] of BUNKER_LIGHTS.slice(0, 4).entries()) {
		const [x, , z] = light.at;
		slots.push(
			mesh(`dd-lamp-${i}`, 'Ceiling Lamp', 'box', [x, H - 0.06, z], [1.5, 0.1, 0.34], STEEL),
			mesh(`dd-bk-lamp-core-${i}`, 'Lamp Tube', 'box', [x, H - 0.16, z], [1.3, 0.06, 0.16], light.intensity > 0 ? COLOR.lamp : '#3a362f', { unlit: true }),
			mesh(`dd-bk-lamp-guard-${i}`, 'Lamp Guard', 'box', [x, H - 0.17, z], [1.42, 0.12, 0.05], DARK),
			mesh(`dd-bk-lamp-guard2-${i}`, 'Lamp Guard', 'box', [x, H - 0.17, z + 0.12], [1.42, 0.12, 0.03], DARK),
			mesh(`dd-bk-lamp-guard3-${i}`, 'Lamp Guard', 'box', [x, H - 0.17, z - 0.12], [1.42, 0.12, 0.03], DARK)
		);
	}
	// Emergency lights.
	for (const [i, light] of BUNKER_LIGHTS.slice(-2).entries()) {
		const [x, y, z] = light.at;
		slots.push(
			mesh(`dd-bk-em-${i}`, 'Emergency Light', 'cylinder', [x, y, z], [0.26, 0.2, 0.26], COLOR.alert, { unlit: true }),
			mesh(`dd-bk-em-base-${i}`, 'Emergency Light Base', 'box', [x, y + 0.14, z], [0.34, 0.08, 0.34], DARK)
		);
	}
	return slots;
}

/** The armory: a gantry over the rack, guns on the back wall, a rubber mat and a bench to check them on. */
function armory(rack: Vec3): Slot[] {
	const [rx, , rz] = rack;
	const slots: Slot[] = [
		mesh('dd-bk-arm-mat', 'Rubber Mat', 'box', [rx, 0.012, rz - 0.9], [3.4, 0.024, 1.8], '#2f3135'),
		mesh('dd-bk-arm-gantry', 'Gantry Beam', 'box', [rx, 3.05, rz - 0.1], [4.0, 0.14, 0.8], STEEL, { material: MATERIAL.plate }),
		mesh('dd-bk-arm-post-l', 'Gantry Post', 'box', [rx - 2.0, 1.6, rz - 0.1], [0.14, 3.2, 0.14], STEEL),
		mesh('dd-bk-arm-post-r', 'Gantry Post', 'box', [rx + 2.0, 1.6, rz - 0.1], [0.14, 3.2, 0.14], STEEL),
		mesh('dd-bk-arm-hood', 'Work Light', 'cylinder', [rx, 2.82, rz - 0.4], [0.9, 0.3, 0.9], COLOR.metalDark),
		mesh('dd-bk-arm-bulb', 'Work Light', 'cylinder', [rx, 2.66, rz - 0.4], [0.7, 0.05, 0.7], COLOR.lamp, { unlit: true }),
		mesh('dd-bk-arm-bench', 'Bench', 'box', [rx - 3.4, 0.5, rz - 0.4], [0.7, 0.08, 2.0], '#d8c3a5', { solid: true, material: MATERIAL.planks }),
		mesh('dd-bk-arm-bench-leg-a', 'Bench Leg', 'box', [rx - 3.4, 0.25, rz - 1.25], [0.6, 0.5, 0.08], COLOR.metalDark),
		mesh('dd-bk-arm-bench-leg-b', 'Bench Leg', 'box', [rx - 3.4, 0.25, rz + 0.45], [0.6, 0.5, 0.08], COLOR.metalDark),
		mesh('dd-bk-arm-vise', 'Vise', 'box', [rx - 3.4, 0.63, rz - 0.9], [0.2, 0.18, 0.2], COLOR.metal),
		mesh('dd-bk-arm-ammo-a', 'Ammo Box', 'box', [rx + 3.2, 0.2, rz - 0.3], [0.7, 0.4, 0.4], '#b8c4ac', { solid: true, material: MATERIAL.olive }),
		mesh('dd-bk-arm-ammo-b', 'Ammo Box', 'box', [rx + 3.3, 0.58, rz - 0.3], [0.55, 0.3, 0.36], COLOR.canvas),
		mesh('dd-bk-arm-ammo-c', 'Ammo Box', 'box', [rx + 3.2, 0.2, rz + 0.3], [0.7, 0.4, 0.4], '#b8c4ac', { solid: true, material: MATERIAL.olive })
	];
	// The wall unit behind the rack: a plywood board in a steel frame, rails with brackets, rifles and pistols on them, a shelf of cans and a helmet.
	const bz = rz + 0.46;
	slots.push(
		mesh('dd-bk-wall-board', 'Wall Unit', 'box', [rx, 1.6, bz], [3.2, 1.8, 0.06], '#d9c7a8', { material: MATERIAL.plywood }),
		mesh('dd-bk-wall-post-l', 'Wall Unit Frame', 'box', [rx - 1.65, 1.5, bz - 0.02], [0.12, 2.8, 0.12], STEEL),
		mesh('dd-bk-wall-post-r', 'Wall Unit Frame', 'box', [rx + 1.65, 1.5, bz - 0.02], [0.12, 2.8, 0.12], STEEL),
		mesh('dd-bk-wall-head', 'Wall Unit Frame', 'box', [rx, 2.55, bz - 0.02], [3.42, 0.16, 0.14], STEEL),
		mesh('dd-bk-wall-sill', 'Wall Unit Frame', 'box', [rx, 0.68, bz - 0.02], [3.42, 0.14, 0.14], STEEL),
		mesh('dd-bk-wall-shelf', 'Wall Shelf', 'box', [rx, 0.85, bz - 0.2], [3.2, 0.05, 0.4], STEEL),
		mesh('dd-bk-wall-can-a', 'Ammo Can', 'box', [rx - 1.1, 1.02, bz - 0.2], [0.34, 0.28, 0.2], COLOR.olive, { material: MATERIAL.olive }),
		mesh('dd-bk-wall-can-b', 'Ammo Can', 'box', [rx - 0.65, 1.0, bz - 0.2], [0.3, 0.24, 0.2], COLOR.olive, { material: MATERIAL.olive }),
		mesh('dd-bk-wall-can-lid-a', 'Ammo Can Lid', 'box', [rx - 1.1, 1.17, bz - 0.2], [0.36, 0.04, 0.22], COLOR.hazard),
		mesh('dd-bk-wall-can-lid-b', 'Ammo Can Lid', 'box', [rx - 0.65, 1.13, bz - 0.2], [0.32, 0.04, 0.22], COLOR.hazard),
		mesh('dd-bk-wall-helmet', 'Helmet', 'sphere', [rx + 1.0, 1.03, bz - 0.2], [0.34, 0.26, 0.34], '#5d6844'),
		mesh('dd-bk-wall-helmet-rim', 'Helmet', 'cylinder', [rx + 1.0, 0.94, bz - 0.2], [0.4, 0.03, 0.4], '#4a5336'),
		mesh('dd-bk-wall-vest', 'Plate Carrier', 'box', [rx + 1.38, 1.1, bz - 0.2], [0.3, 0.4, 0.12], '#6a6f4a')
	);
	const rifle = (key: string, x: number, y: number, kind: 'rifle' | 'smg') => {
		const z = bz - 0.1;
		const long = kind === 'rifle' ? 1.0 : 0.7;
		const part = (name: string, dx: number, dy: number, size: Vec3, color: string, shape: 'box' | 'cylinder' = 'box', rotation?: Quat) =>
			mesh(`dd-bk-gun-${key}-${name}`, kind === 'rifle' ? 'Rifle' : 'Submachine Gun', shape, [x + dx, y + dy, z], size, color, rotation ? { rotation } : {});
		return [
			// A rail and two brackets it lies on.
			mesh(`dd-bk-gun-${key}-bracket-a`, 'Bracket', 'box', [x - long * 0.3, y - 0.07, bz - 0.04], [0.05, 0.06, 0.14], STEEL),
			mesh(`dd-bk-gun-${key}-bracket-b`, 'Bracket', 'box', [x + long * 0.2, y - 0.07, bz - 0.04], [0.05, 0.06, 0.14], STEEL),
			part('receiver', 0, 0, [long * 0.5, 0.1, 0.07], '#2a2c30'),
			part('barrel', long * 0.5, 0.01, [0.03, long * 0.55, 0.03], '#17181a', 'cylinder', alongX),
			part('handguard', long * 0.24, -0.005, [long * 0.28, 0.08, 0.075], '#4a3a2a'),
			part('stock', -long * 0.4, -0.03, [long * 0.3, 0.13, 0.06], '#3a2f26'),
			part('grip', -long * 0.12, -0.12, [0.06, 0.16, 0.06], '#1f2023'),
			part('mag', long * 0.08, -0.14, [0.07, 0.2, 0.06], '#1b1c1f'),
			part('sight', long * 0.02, 0.09, [0.2, 0.05, 0.05], '#101113')
		];
	};
	slots.push(...rifle('a', rx - 0.55, 2.15, 'rifle'), ...rifle('b', rx + 0.55, 2.15, 'smg'), ...rifle('c', rx - 0.55, 1.6, 'smg'), ...rifle('d', rx + 0.55, 1.6, 'rifle'));
	return slots;
}

/** A lamp in a cage on a wall: a bracket, a glass and three bars. `facing` is the axis it sticks out along. */
function sconce(key: string, at: Vec3, facing: 'x' | 'z'): Slot[] {
	const [x, y, z] = at;
	const out = (d: number): Vec3 => (facing === 'x' ? [x + d, y, z] : [x, y, z + (d * -1)]);
	const size = (a: number, b: number, c: number): Vec3 => (facing === 'x' ? [a, b, c] : [c, b, a]);
	return [
		mesh(`dd-bk-sconce-${key}-plate`, 'Wall Lamp', 'box', out(0), size(0.06, 0.3, 0.2), '#2b2d31'),
		mesh(`dd-bk-sconce-${key}-glass`, 'Wall Lamp', 'cylinder', out(0.16), facing === 'x' ? [0.18, 0.26, 0.18] : [0.18, 0.26, 0.18], '#ffe2b0', { unlit: true }),
		mesh(`dd-bk-sconce-${key}-cap`, 'Wall Lamp', 'box', out(0.16), size(0.24, 0.04, 0.24), '#2b2d31', { }),
		mesh(`dd-bk-sconce-${key}-bar-a`, 'Wall Lamp Cage', 'box', out(0.16), size(0.22, 0.28, 0.025), '#1d1e21'),
		mesh(`dd-bk-sconce-${key}-bar-b`, 'Wall Lamp Cage', 'box', out(0.16), size(0.025, 0.28, 0.22), '#1d1e21')
	];
}

/** The stash: lockers with handles and numbers, a bench to sit on, and the clock on the wall. */
function stash(): Slot[] {
	const slots: Slot[] = [];
	for (let i = 0; i < 8; i++) {
		const z = 1.4 + i * 0.62;
		slots.push(
			mesh(`dd-bk-handle-${i}`, 'Locker Handle', 'box', [X0 + 0.62, 1.15, z + 0.18], [0.04, 0.16, 0.04], COLOR.hazard),
			mesh(`dd-bk-vent-${i}`, 'Locker Vent', 'box', [X0 + 0.66, 1.75, z], [0.02, 0.1, 0.34], DARK)
		);
	}
	slots.push(
		mesh('dd-bk-bench-seat', 'Bench', 'box', [X0 + 1.6, 0.45, 3.7], [0.4, 0.07, 2.4], '#d8c3a5', { solid: true, material: MATERIAL.planks }),
		mesh('dd-bk-bench-leg-a', 'Bench Leg', 'box', [X0 + 1.6, 0.22, 2.7], [0.36, 0.44, 0.06], COLOR.metalDark),
		mesh('dd-bk-bench-leg-b', 'Bench Leg', 'box', [X0 + 1.6, 0.22, 4.7], [0.36, 0.44, 0.06], COLOR.metalDark),
		mesh('dd-bk-stash-line', 'Floor Line', 'box', [X0 + 2.6, 0.006, 3.7], [0.12, 0.012, 5.4], COLOR.hazard),
		// A bare bulb on a cord.
		mesh('dd-bk-bulb-cord', 'Cord', 'box', [-8.2, 3.62, 3.7], [0.02, 0.76, 0.02], COLOR.black),
		mesh('dd-bk-bulb', 'Bulb', 'sphere', [-8.2, 3.2, 3.7], [0.16, 0.2, 0.16], '#ffe9b8', { unlit: true }),
		// A caged wall lamp in the north-west corner.
	...sconce('w', [X0 + 0.2, 2.95, 9.6], 'x'),
	// A clock.
		mesh('dd-bk-clock', 'Clock', 'cylinder', [X0 + 0.14, 2.6, 6.6], [0.5, 0.06, 0.5], COLOR.canvas, { rotation: alongX }),
		mesh('dd-bk-clock-hand-a', 'Clock Hand', 'box', [X0 + 0.19, 2.64, 6.6], [0.02, 0.2, 0.03], DARK),
		mesh('dd-bk-clock-hand-b', 'Clock Hand', 'box', [X0 + 0.19, 2.6, 6.66], [0.02, 0.03, 0.14], DARK)
	);
	return slots;
}

/** The trader's corner: an awning over the counter, a lantern, crates behind and jars on the counter. */
function trader(): Slot[] {
	const tilt: Quat = [0, 0, Math.sin(0.12), Math.cos(0.12)];
	return [
		mesh('dd-bk-awning', 'Awning', 'box', [8.4, 2.75, 8], [2.2, 0.05, 4.8], COLOR.canvas, { rotation: tilt }),
		mesh('dd-bk-awning-stripe', 'Awning Stripe', 'box', [8.4, 2.77, 8], [2.2, 0.05, 0.6], SAFETY_RED, { rotation: tilt }),
		mesh('dd-bk-awning-post-a', 'Awning Post', 'box', [7.2, 1.4, 5.7], [0.08, 2.8, 0.08], COLOR.metalDark),
		mesh('dd-bk-awning-post-b', 'Awning Post', 'box', [7.2, 1.4, 10.3], [0.08, 2.8, 0.08], COLOR.metalDark),
		mesh('dd-bk-lantern-cord', 'Lantern Cord', 'box', [8.2, 2.9, 8], [0.02, 0.4, 0.02], COLOR.black),
		mesh('dd-bk-lantern', 'Lantern', 'cylinder', [8.2, 2.6, 8], [0.22, 0.3, 0.22], '#ffb347', { unlit: true }),
		mesh('dd-bk-trader-crate-a', 'Crate', 'box', [9.3, 0.35, 6.4], [0.8, 0.7, 0.8], '#d8c3a5', { solid: true, material: MATERIAL.planks }),
		mesh('dd-bk-trader-crate-b', 'Crate', 'box', [9.4, 0.95, 6.4], [0.6, 0.5, 0.6], COLOR.olive),
		mesh('dd-bk-trader-crate-c', 'Crate', 'box', [9.2, 0.3, 5.95], [0.7, 0.6, 0.7], '#b8c4ac', { solid: true, material: MATERIAL.olive }),
		mesh('dd-bk-jar-a', 'Jar', 'cylinder', [7.6, 1.2, 6.6], [0.16, 0.22, 0.16], '#c9d6a3'),
		mesh('dd-bk-jar-b', 'Jar', 'cylinder', [7.8, 1.2, 6.9], [0.14, 0.2, 0.14], '#d6a35c'),
		mesh('dd-bk-scale', 'Scale', 'box', [7.7, 1.15, 9.3], [0.3, 0.1, 0.3], COLOR.metal),
		mesh('dd-bk-trader-stripe', 'Floor Line', 'box', [6.0, 0.006, 8], [0.12, 0.012, 4.8], COLOR.hazard)
	];
}

/** The way to the raid: chevrons on the floor, hazard posts and a beacon over the gate. */
function gate(): Slot[] {
	const slots: Slot[] = [];
	const chevron = (id: string, x: number, z: number, yaw: number) => mesh(id, 'Floor Chevron', 'box', [x, 0.007, z], [0.9, 0.012, 0.16], COLOR.hazard, { rotation: yawOf(yaw) });
	for (const [i, x] of [5.2, 6.4, 7.6].entries()) {
		slots.push(chevron(`dd-bk-chev-${i}-a`, x, 1.8 + 0.28, -quarter * 1.3), chevron(`dd-bk-chev-${i}-b`, x, 1.8 - 0.28, quarter * 1.3));
	}
	slots.push(
		mesh('dd-bk-gate-post-a', 'Hazard Post', 'cylinder', [8.6, 0.45, -0.4], [0.18, 0.9, 0.18], COLOR.hazard, { solid: true }),
		mesh('dd-bk-gate-post-b', 'Hazard Post', 'cylinder', [8.6, 0.45, 4.0], [0.18, 0.9, 0.18], COLOR.hazard, { solid: true }),
		mesh('dd-bk-gate-beacon', 'Beacon', 'cylinder', [9.2, 3.75, 1.8], [0.3, 0.2, 0.3], COLOR.alert, { unlit: true }),
		mesh('dd-bk-gate-beacon-base', 'Beacon Base', 'box', [9.2, 3.9, 1.8], [0.4, 0.1, 0.4], DARK),
		mesh('dd-bk-gate-track', 'Gate Track', 'box', [9.5, 3.5, 1.8], [0.3, 0.1, 5.2], STEEL, { material: MATERIAL.plate })
	);
	return slots;
}

/** The war table: stools, a hood with its lamp, boards with notes and a stack of folders. */
function warRoom(): Slot[] {
	const slots: Slot[] = [
		mesh('dd-bk-hood', 'Table Hood', 'cylinder', [0, 3.15, 10.4], [1.6, 0.3, 1.6], COLOR.metalDark),
		mesh('dd-bk-hood-lamp', 'Table Lamp', 'cylinder', [0, 2.98, 10.4], [1.3, 0.04, 1.3], '#cfe6ff', { unlit: true }),
		mesh('dd-bk-hood-cord-a', 'Hanger', 'box', [-0.5, 3.6, 10.4], [0.03, 0.8, 0.03], DARK),
		mesh('dd-bk-hood-cord-b', 'Hanger', 'box', [0.5, 3.6, 10.4], [0.03, 0.8, 0.03], DARK)
	];
	for (const [i, [x, z]] of [[-1.4, 9.5], [1.4, 9.5], [-1.2, 11.4], [1.2, 11.4]].entries()) {
		slots.push(
			mesh(`dd-bk-stool-${i}`, 'Stool', 'cylinder', [x, 0.28, z], [0.36, 0.56, 0.36], COLOR.metalDark),
			mesh(`dd-bk-stool-seat-${i}`, 'Stool Seat', 'cylinder', [x, 0.58, z], [0.4, 0.06, 0.4], COLOR.canvas)
		);
	}
	slots.push(
		mesh('dd-bk-folders-a', 'Folders', 'box', [1.2, 0.99, 10.6], [0.32, 0.06, 0.24], COLOR.wood),
		mesh('dd-bk-folders-b', 'Folders', 'box', [1.22, 1.04, 10.6], [0.3, 0.05, 0.22], COLOR.canvas),
		mesh('dd-bk-mug', 'Mug', 'cylinder', [-1.2, 1.0, 10.1], [0.09, 0.1, 0.09], COLOR.rust)
	);
	slots.push(...sconce('n', [-6.2, 3.15, Z1 - 0.1], 'z'));
	// The gear wall (deadDropGear.ts) hangs on the north wall, to the west of the sign.
	return slots;
}

/** The corner where the squad sleeps, and the things left lying about. */
function corners(): Slot[] {
	const slots: Slot[] = [
		...composite('dd-bk-bunk-0', 'Bunk', [-5.7, 0, Z0 + 0.7], 0, FURNITURE.bunk),
		...composite('dd-bk-bunk-1', 'Bunk', [-4.3, 0, Z0 + 0.7], 0, FURNITURE.bunk),
		mesh('dd-bk-footlocker-0', 'Footlocker', 'box', [-5.7, 0.2, Z0 + 1.35], [0.8, 0.4, 0.4], COLOR.olive, { solid: true }),
		mesh('dd-bk-footlocker-1', 'Footlocker', 'box', [-4.3, 0.2, Z0 + 1.35], [0.8, 0.4, 0.4], COLOR.wood, { solid: true }),
		// A tarp over the crates in the south-west corner.
		mesh('dd-bk-tarp', 'Tarp', 'box', [-8.3, 1.72, -2.45], [2.3, 0.05, 1.4], '#3f5a4a', { rotation: [0, 0, Math.sin(0.08), Math.cos(0.08)] }),
		// Oil drums and a pallet in the south-east corner.
		mesh('dd-bk-pallet', 'Pallet', 'box', [6.4, 0.08, -2.2], [1.2, 0.16, 1.0], COLOR.wood, { solid: true }),
		mesh('dd-bk-pallet-box-a', 'Box', 'box', [6.2, 0.45, -2.2], [0.6, 0.5, 0.6], COLOR.canvas),
		mesh('dd-bk-pallet-box-b', 'Box', 'box', [6.75, 0.4, -2.0], [0.4, 0.4, 0.5], COLOR.olive),
		// A fire extinguisher, a first-aid cabinet and a valve wheel on the pilasters and walls.
		mesh('dd-bk-extinguisher', 'Fire Extinguisher', 'cylinder', [-3, 0.75, Z0 + 0.59], [0.18, 0.5, 0.18], SAFETY_RED),
		mesh('dd-bk-extinguisher-top', 'Fire Extinguisher', 'box', [-3, 1.04, Z0 + 0.59], [0.08, 0.1, 0.08], COLOR.black),
		mesh('dd-bk-aid', 'First Aid', 'box', [3.0, 1.7, Z0 + 0.58], [0.5, 0.5, 0.12], '#e9e6df'),
		mesh('dd-bk-aid-cross-a', 'First Aid Cross', 'box', [3.0, 1.7, Z0 + 0.49], [0.28, 0.08, 0.02], SAFETY_RED, { unlit: true }),
		mesh('dd-bk-aid-cross-b', 'First Aid Cross', 'box', [3.0, 1.7, Z0 + 0.49], [0.08, 0.28, 0.02], SAFETY_RED, { unlit: true }),
		mesh('dd-bk-valve-pipe', 'Water Pipe', 'cylinder', [X1 - 0.5, 1.7, 11.2], [0.16, 1.2, 0.16], COLOR.metalDark, { rotation: alongX }),
		mesh('dd-bk-valve', 'Valve Wheel', 'cylinder', [X1 - 1.15, 1.7, 11.2], [0.34, 0.05, 0.34], SAFETY_RED, { rotation: alongX }),
		// Electrical boxes with a lit indicator.
		mesh('dd-bk-elec-a', 'Electrical Box', 'box', [X0 + 0.55, 1.6, -3.0], [0.14, 0.7, 0.5], STEEL),
		mesh('dd-bk-elec-a-led', 'Indicator', 'sphere', [X0 + 0.63, 1.8, -3.0], [0.06, 0.06, 0.06], COLOR.go, { unlit: true }),
		mesh('dd-bk-elec-b', 'Electrical Box', 'box', [X1 - 0.55, 1.6, -3.0], [0.14, 0.7, 0.5], STEEL),
		mesh('dd-bk-elec-b-led', 'Indicator', 'sphere', [X1 - 0.63, 1.8, -3.0], [0.06, 0.06, 0.06], COLOR.alert, { unlit: true })
	];
	return slots;
}

/** The floor: panels of darker concrete under the walkways, and a walkway to the war table. */
function floorMarkings(): Slot[] {
	return [
		mesh('dd-bk-walkway', 'Walkway', 'box', [0, 0.002, 4.2], [2.4, 0.004, 9.4], '#7b7872'),
		mesh('dd-bk-walkway-edge-l', 'Walkway Edge', 'box', [-1.2, 0.012, 4.2], [0.08, 0.012, 9.4], COLOR.hazard),
		mesh('dd-bk-walkway-edge-r', 'Walkway Edge', 'box', [1.2, 0.012, 4.2], [0.08, 0.012, 9.4], COLOR.hazard),
		mesh('dd-bk-console-pad', 'Console Pad', 'box', [4, 0.005, 3], [1.8, 0.01, 1.4], COLOR.black),
		mesh('dd-bk-map-rug', 'Rug', 'box', [0, 0.007, 10.9], [4.0, 0.014, 1.8], '#4a3b2f')
	];
}

/** Everything the bunker has besides the walls, the floor, the screens and the game's own pieces. */
export function bunkerDecor(rack: Vec3): Slot[] {
	return [...structure(), ...overhead(), ...armory(rack), ...stash(), ...trader(), ...gate(), ...warRoom(), ...corners(), ...floorMarkings()];
}
