import type { Slot } from '@kithin/engine/ecs/types';
import type { Vec3 } from './arcadeKit.ts';
import { GUN_MODELS } from './deadDropActors.ts';
import { PARKED, mesh } from './deadDropKit.ts';
import { sign } from './deadDropBunker.ts';
import { COLOR, MATERIAL, composite } from './deadDropLook.ts';
import type { Part } from './deadDropLook.ts';

/**
 * The gear wall: the south wall, east of the way in, shows what the player at it owns. Weapons hang on pegs, armour stands on
 * mannequins, ammunition and medkits sit on a shelf, and what has been looted is laid out above it. The things are pooled and
 * parked; the director moves in what the stash holds (see GEAR_SOURCE).
 */

/**
 * The wall is designed here as if it stood on the south wall, facing +z; `onNorthWall` turns it half a turn about the vertical axis
 * onto the north wall, in front of those who arrive (they look along +z) and west of the briefing sign, where the notice board was.
 */
const onNorthWall = (x: number, z: number): [number, number] => [-1.2 - x, 8.0 - z];
const placed = (v: readonly [number, number, number]): Vec3 => [onNorthWall(v[0], v[2])[0], v[1], onNorthWall(v[0], v[2])[1]];

/** Where the wall is on the floor plan (x, z): the gear shown is that of the nearest player, at any distance. */
export const GEAR_AT = onNorthWall(5.0, -3.4);

export const GEAR_WAKE = 1000;
const WALL_Z = -3.84;
const SHELF_Z = -3.62;

/** What each pooled thing is called and where it goes when shown; every pool is `count` long. */
const DESIGN = {
	pistol: Array.from({ length: 2 }, (_, i): Vec3 => [4.15 + i * 0.7, 1.72, WALL_Z + 0.1]),
	smg: Array.from({ length: 2 }, (_, i): Vec3 => [4.5 + i * 1.05, 2.12, WALL_Z + 0.1]),
	vest: [[3.75, 0, -3.3], [6.25, 0, -3.3]] as Vec3[],
	ammo: Array.from({ length: 4 }, (_, i): Vec3 => [3.55 + i * 0.4, 0.76, SHELF_Z]),
	med: Array.from({ length: 3 }, (_, i): Vec3 => [5.35 + i * 0.32, 0.74, SHELF_Z]),
	suppressor: [[6.45, 0.76, SHELF_Z]] as Vec3[],
	loot: Array.from({ length: 6 }, (_, i): Vec3 => [3.75 + i * 0.5, 1.2, SHELF_Z])
};
export const GEAR = Object.fromEntries(Object.entries(DESIGN).map(([kind, list]) => [kind, list.map(placed)])) as Record<keyof typeof DESIGN, Vec3[]>;

export const gearId = (kind: keyof typeof GEAR, i: number): string => `dd-gw-${kind}-${i}`;

const gunParts = (kind: 'pistol' | 'smg'): Part[] => [
	...GUN_MODELS[kind].parts.map((part): Part => ({ key: part.key, shape: 'box', position: part.position, scale: part.scale, color: part.color, unlit: part.unlit })),
	{ key: 'grip', shape: 'box', position: [0, -0.05, -0.02], scale: [0.034, 0.11, 0.044], color: '#1b1c1e' },
	{ key: 'frame', shape: 'box', position: [0, 0.012, 0.04], scale: [0.045, 0.05, 0.16], color: '#2b2d31' }
];

/** A vest on its mannequin: a torso with straps, shoulders and (on the better one) plates. */
const vestParts = (plates: boolean, color: string): Part[] => [
	{ key: 'torso', shape: 'box', position: [0, 1.28, 0], scale: [0.5, 0.58, 0.28], color },
	{ key: 'shoulder-l', shape: 'box', position: [-0.2, 1.62, 0], scale: [0.12, 0.08, 0.26], color },
	{ key: 'shoulder-r', shape: 'box', position: [0.2, 1.62, 0], scale: [0.12, 0.08, 0.26], color },
	{ key: 'belt', shape: 'box', position: [0, 1.0, 0], scale: [0.54, 0.07, 0.3], color: '#26282b' },
	...(plates ? [{ key: 'plate', shape: 'box' as const, position: [0, 1.32, 0.15] as Vec3, scale: [0.34, 0.38, 0.04] as Vec3, color: '#1c1f24' }, { key: 'pouch', shape: 'box' as const, position: [0, 1.05, 0.17] as Vec3, scale: [0.36, 0.14, 0.06] as Vec3, color: '#4a4f38' }] : [{ key: 'pouch', shape: 'box' as const, position: [0.1, 1.1, 0.16] as Vec3, scale: [0.14, 0.16, 0.05] as Vec3, color: '#2f3321' }])
];

export function buildGearWall(): Slot[] {
	const slots: Slot[] = [
		mesh('dd-gw-board', 'Gear Board', 'box', [5.0, 1.5, WALL_Z], [3.5, 2.5, 0.05], '#d9c7a8', { material: MATERIAL.plywood }),
		mesh('dd-gw-frame-l', 'Gear Board Frame', 'box', [5.0 - 1.78, 1.5, WALL_Z + 0.02], [0.08, 2.58, 0.1], COLOR.metalDark),
		mesh('dd-gw-frame-r', 'Gear Board Frame', 'box', [5.0 + 1.78, 1.5, WALL_Z + 0.02], [0.08, 2.58, 0.1], COLOR.metalDark),
		mesh('dd-gw-frame-t', 'Gear Board Frame', 'box', [5.0, 2.78, WALL_Z + 0.02], [3.64, 0.08, 0.1], COLOR.metalDark),
		mesh('dd-gw-shelf', 'Gear Shelf', 'box', [5.0, 0.7, SHELF_Z - 0.04], [3.5, 0.05, 0.42], COLOR.metalDark),
		mesh('dd-gw-shelf-up', 'Gear Shelf', 'box', [5.0, 1.1, SHELF_Z - 0.04], [3.5, 0.05, 0.42], COLOR.metalDark),
		sign('dd-gw-sign', [5.0, 2.52, WALL_Z + 0.06], 0, 3.0, 0.5, 'YOUR GEAR', ['Step up to see yours'], 1.6),
		// Pegs the weapons hang on, and the mannequins' stands: always there, with or without what belongs on them.
		...DESIGN.pistol.map((at, i) => mesh(`dd-gw-peg-p${i}`, 'Peg', 'box', [at[0], at[1] - 0.04, WALL_Z + 0.05], [0.24, 0.025, 0.06], COLOR.metal)),
		...DESIGN.smg.map((at, i) => mesh(`dd-gw-peg-s${i}`, 'Peg', 'box', [at[0], at[1] - 0.04, WALL_Z + 0.05], [0.5, 0.025, 0.06], COLOR.metal)),
		...DESIGN.vest.flatMap((at, i) => [
			mesh(`dd-gw-stand-${i}`, 'Mannequin', 'cylinder', [at[0], 0.6, at[2]], [0.06, 1.2, 0.06], COLOR.metalDark),
			mesh(`dd-gw-base-${i}`, 'Mannequin Base', 'cylinder', [at[0], 0.03, at[2]], [0.5, 0.06, 0.5], COLOR.metalDark),
			mesh(`dd-gw-head-${i}`, 'Mannequin', 'sphere', [at[0], 1.82, at[2]], [0.22, 0.26, 0.22], '#8d8a83')
		])
	];
	GEAR.pistol.forEach((_, i) => slots.push(...composite(gearId('pistol', i), 'Pistol', PARKED, Math.PI / 2, gunParts('pistol'), { parked: true })));
	GEAR.smg.forEach((_, i) => slots.push(...composite(gearId('smg', i), 'Submachine Gun', PARKED, Math.PI / 2, gunParts('smg'), { parked: true })));
	GEAR.vest.forEach((_, i) => slots.push(...composite(gearId('vest', i), i ? 'Plate Carrier' : 'Light Vest', PARKED, 0, vestParts(i === 1, i ? '#334155' : '#475569'), { parked: true })));
	GEAR.ammo.forEach((_, i) =>
		slots.push(
			mesh(gearId('ammo', i), 'Ammo Can', 'box', PARKED, [0.34, 0.24, 0.2], '#b8c4ac', { material: MATERIAL.olive }),
			mesh(`${gearId('ammo', i)}-lid`, 'Ammo Can Lid', 'box', [0, 0.55, 0], [1.04, 0.12, 1.04], COLOR.hazard, { parentId: gearId('ammo', i) })
		)
	);
	GEAR.med.forEach((_, i) =>
		slots.push(
			mesh(gearId('med', i), 'Medkit', 'box', PARKED, [0.28, 0.2, 0.14], '#e9e6df'),
			mesh(`${gearId('med', i)}-cross-a`, 'Medkit Cross', 'box', [0, 0, 0.55], [0.5, 0.14, 0.05], COLOR.alert, { parentId: gearId('med', i), unlit: true }),
			mesh(`${gearId('med', i)}-cross-b`, 'Medkit Cross', 'box', [0, 0, 0.55], [0.14, 0.5, 0.05], COLOR.alert, { parentId: gearId('med', i), unlit: true })
		)
	);
	slots.push(mesh(gearId('suppressor', 0), 'Suppressor', 'cylinder', PARKED, [0.07, 0.3, 0.07], '#3a3d42', { rotation: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] }));
	GEAR.loot.forEach((_, i) => slots.push(mesh(gearId('loot', i), 'Loot', 'box', PARKED, [0.22, 0.16, 0.22], '#a8a29e', { unlit: true })));
	// Turn every free-standing piece (the parts of a composite follow their root) half a turn about Y onto the north wall.
	return slots.map((slot) => {
		if (slot.parentId) return slot;
		const [x, y, z] = slot.position, [qx, qy, qz, qw] = slot.rotation;
		const [nx, nz] = onNorthWall(x, z);
		// Parked pieces stay parked: they are only moved when shown, to places already in the new frame.
		const parked = y < -100;
		return { ...slot, position: parked ? slot.position : [nx, y, nz], rotation: [qz, qw, -qx, -qy] };
	});
}

/** The part of the director's script that shows the stash of the player at the wall. */
export const GEAR_SOURCE = `
const GEAR = ${JSON.stringify(GEAR)}, GEAR_AT = ${JSON.stringify(GEAR_AT)}, GEAR_WAKE = ${GEAR_WAKE};
const GW = { user: '' };
const gearId = (kind, i) => 'dd-gw-' + kind + '-' + i;
function showGear(kind, i, shown) {
	if (shown) ctx.world.setWorldPose(gearId(kind, i), { position: GEAR[kind][i] }, false);
	else park(gearId(kind, i));
}
/** What the stash holds, laid out on the wall: the guns on their pegs, the vests on the mannequins, cans, medkits, a suppressor and the loot. */
function renderGear() {
	const profile = GW.user ? profileOf(GW.user) : null, who = GW.user && players.get(GW.user);
	field('dd-gw-sign', 'textDisplay', 'lines', [who ? who.name + '’s stash' : 'Step up to see yours']);
	const n = (id) => (profile ? countIn(profile.stash, id) : 0);
	for (let i = 0; i < 2; i++) { showGear('pistol', i, n('pistol') > i); showGear('smg', i, n('smg') > i); }
	showGear('vest', 0, n('armor1') > 0); showGear('vest', 1, n('armor2') > 0);
	const cans = Math.min(4, Math.ceil(n('ammo9') / 45));
	for (let i = 0; i < 4; i++) showGear('ammo', i, i < cans);
	for (let i = 0; i < 3; i++) showGear('med', i, i < n('medkit'));
	showGear('suppressor', 0, n('suppressor') > 0);
	const loot = profile ? profile.stash.filter((e) => ITEMS[e.id].kind === 'loot').sort((a, b) => ITEMS[b.id].value * b.n - ITEMS[a.id].value * a.n) : [];
	for (let i = 0; i < 6; i++) {
		showGear('loot', i, !!loot[i]);
		if (loot[i]) field(gearId('loot', i), 'meshRenderer', 'color', ITEMS[loot[i].id].color);
	}
	markFlush();
}
`;
