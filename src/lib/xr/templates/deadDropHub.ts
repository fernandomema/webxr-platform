import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, ui, yawQuat } from './arcadeKit.ts';
import type { Vec3 } from './arcadeKit.ts';
import { GATE, ID, mesh } from './deadDropKit.ts';
import { BUNKER_LIGHTS, bunkerDecor, sign } from './deadDropBunker.ts';
import { COLOR, FURNITURE, HUMAN, MATERIAL, composite } from './deadDropLook.ts';
import { directorScript } from './deadDropScript.ts';
import { TRADER_AT } from './deadDropScreens.ts';

/** The bunker the squad prepares in: x from -10 to 10 and z from -4 to 12, arriving at the origin and looking along +z. */
export const HUB_ROOM = { minX: -10, maxX: 10, minZ: -4, maxZ: 12, height: 4 } as const;
/** The rack the weapons wait on (the guns stand a little above it). */
export const RACK: Vec3 = [0, 1.0, 6];
export const CONSOLE_AT: Vec3 = [4, 0, 3];

const WALL_TINT = '#8f8b82';
const sideways: [number, number, number, number] = [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)];

export function buildHub(): Slot[] {
	const { minX, maxX, minZ, maxZ, height } = HUB_ROOM;
	void TRADER_AT;
	const midX = (minX + maxX) / 2, midZ = (minZ + maxZ) / 2, width = maxX - minX, depth = maxZ - minZ;
	const wall = (id: string, at: Vec3, scale: Vec3) => mesh(id, 'Wall', 'box', at, scale, WALL_TINT, { solid: true, material: MATERIAL.wall });
	const slots: Slot[] = [
		createSlot({ id: 'dd-sky', name: 'Sky', components: [{ type: 'skybox', topColor: '#0d0d10', horizonColor: '#26211b', bottomColor: '#070707', stars: 0.15, ambientIntensity: 1.2, toneMapping: 'aces' }] }),
		createSlot({ id: 'dd-spawn', name: 'Spawn Point', position: [0, 0, 0], components: [{ type: 'spawnPoint' }] }),
		createSlot({ id: ID.flush, name: 'Flush', components: [{ type: 'scriptState', data: { n: 0 } }] }),
		createSlot({ id: ID.commands, name: 'Commands', components: [{ type: 'container' }] }),
		createSlot({
			id: 'dd-floor',
			name: 'Floor',
			position: [midX, -0.05, midZ],
			scale: [width / 20, 1, depth / 20],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#8a877f' }, MATERIAL.floor, { type: 'collider', shape: 'box' }]
		}),
		wall('dd-wall-n', [midX, height / 2, maxZ + 0.1], [width + 0.4, height, 0.2]),
		wall('dd-wall-s', [midX, height / 2, minZ - 0.1], [width + 0.4, height, 0.2]),
		wall('dd-wall-w', [minX - 0.1, height / 2, midZ], [0.2, height, depth]),
		wall('dd-wall-e', [maxX + 0.1, height / 2, midZ], [0.2, height, depth]),
		mesh('dd-ceiling', 'Ceiling', 'box', [midX, height + 0.1, midZ], [width + 0.4, 0.2, depth + 0.4], '#6e7076', { material: MATERIAL.plate }),
		...BUNKER_LIGHTS.filter((light) => light.intensity > 0).map((light) => createSlot({ id: light.id, name: 'Ceiling Light', position: light.at, components: [{ type: 'pointLight', color: light.color, intensity: light.intensity, range: light.range, baked: true }] })),
		...bunkerDecor(RACK)
	];

	slots.push(createSlot({ id: 'dd-dust-0', name: 'Dust', position: [0, 1.6, 5], components: [{ type: 'particleEmitter', color: '#d9d4c7', capacity: 40, rate: 5, radius: 7, size: 0.05, lifetime: 8, speed: 0.06, opacity: 0.25, active: true }] }));

	// Hazard lines on the floor lead from where the squad arrives to the rack and the console.
	slots.push(
		mesh('dd-line-rack', 'Floor Line', 'box', [0, 0.006, 2.4], [0.18, 0.012, 3.4], COLOR.hazard),
		mesh('dd-line-console', 'Floor Line', 'box', [2.15, 0.006, 3.0], [1.9, 0.012, 0.18], COLOR.hazard)
	);

	// North: the briefing and the table with the map.
	slots.push(
		sign('dd-sign', [0, 2.7, maxZ - 0.12], Math.PI, 6.4, 2.4, 'DEAD DROP', ['Take a weapon, equip it, press JOIN, then START RAID.', 'Loot the bunker. Every shot is heard: be quiet or be fast.', 'Reach a green exit and hold it. Die, and you lose what you carried.'], 1.1),
		mesh('dd-table-base', 'Map Table', 'box', [0, 0.43, 10.4], [2.6, 0.85, 1.0], COLOR.metalDark, { solid: true }),
		mesh('dd-table-top', 'Map Table', 'box', [0, 0.9, 10.4], [3.0, 0.1, 1.5], COLOR.metal),
		mesh('dd-table-map', 'Map', 'plane', [0, 0.97, 10.4], [2.8, 1.3, 1], '#1d6a9c', { unlit: true, rotation: sideways })
	);

	// West: the lockers of the stash.
	for (let i = 0; i < 8; i++) {
		slots.push(mesh(`dd-locker-${i}`, 'Locker', 'box', [minX + 0.4, 0.95, 1.4 + i * 0.62], [0.5, 1.9, 0.56], i % 2 ? '#b8c4ac' : '#6b747d', { solid: true, ...(i % 2 ? { material: MATERIAL.olive } : {}) }));
	}
	slots.push(sign('dd-sign-stash', [minX + 0.12, 2.5, 3.6], Math.PI / 2, 2.4, 0.6, 'STASH', [], 4.5));

	// East: the trader's counter, shelves and trader, and the gate to the raid.
	slots.push(
		mesh('dd-counter', 'Counter', 'box', [maxX - 2.4, 0.5, 8], [0.9, 1.0, 4.2], '#d8c3a5', { solid: true, material: MATERIAL.planks }),
		mesh('dd-counter-top', 'Counter Top', 'box', [maxX - 2.4, 1.03, 8], [1.1, 0.07, 4.4], COLOR.metalDark),
		...composite('dd-trader-shelf', 'shelf', [maxX - 0.4, 0, 9.6], -Math.PI / 2, FURNITURE.shelf),
		...composite('dd-trader', 'Trader', [maxX - 1.3, 0, 8], -Math.PI / 2, HUMAN),
		sign('dd-sign-trader', [maxX - 0.12, 3.0, 8], -Math.PI / 2, 2.4, 0.6, 'TRADER', [], 4.5),
		// The raid gate.
		mesh('dd-gate-door', 'Raid Gate', 'box', [maxX - 0.18, 1.5, 1.8], [0.16, 3.0, 2.8], '#cfd8c6', { solid: true, material: MATERIAL.olive }),
		mesh('dd-gate-band', 'Hazard Band', 'box', [maxX - 0.3, 0.28, 1.8], [0.05, 0.5, 2.8], COLOR.hazard),
		mesh('dd-gate-band-t', 'Hazard Band', 'box', [maxX - 0.3, 2.9, 1.8], [0.05, 0.14, 2.8], COLOR.hazard),
		mesh('dd-gate-panel-a', 'Door Panel', 'box', [maxX - 0.3, 1.5, 1.1], [0.05, 1.5, 1.0], '#8a9686', { material: MATERIAL.olive }),
		mesh('dd-gate-panel-b', 'Door Panel', 'box', [maxX - 0.3, 1.5, 2.5], [0.05, 1.5, 1.0], '#8a9686', { material: MATERIAL.olive }),
		mesh('dd-gate-panel-in-a', 'Door Panel', 'box', [maxX - 0.33, 1.5, 1.1], [0.03, 1.2, 0.74], '#bcc6b6', { material: MATERIAL.olive }),
		mesh('dd-gate-panel-in-b', 'Door Panel', 'box', [maxX - 0.33, 1.5, 2.5], [0.03, 1.2, 0.74], '#bcc6b6', { material: MATERIAL.olive }),
		mesh('dd-gate-rib', 'Door Rib', 'box', [maxX - 0.3, 1.7, 1.8], [0.06, 2.3, 0.1], COLOR.metalDark),
		mesh('dd-gate-post-a', 'Gate Frame', 'box', [maxX - 0.3, 1.6, 0.25], [0.36, 3.2, 0.3], COLOR.hazard),
		mesh('dd-gate-post-b', 'Gate Frame', 'box', [maxX - 0.3, 1.6, 3.35], [0.36, 3.2, 0.3], COLOR.hazard),
		mesh('dd-gate-top', 'Gate Frame', 'box', [maxX - 0.3, 3.2, 1.8], [0.36, 0.3, 3.4], COLOR.hazard),
		mesh(GATE.open, 'Gate Lamp', 'sphere', [maxX - 0.5, 2.85, 1.0], [0.28, 0.28, 0.28], COLOR.go, { unlit: true }),
		{ ...mesh(GATE.closed, 'Gate Lamp', 'sphere', [maxX - 0.5, 2.85, 2.6], [0.28, 0.28, 0.28], COLOR.alert, { unlit: true }), disabled: true },
		sign('dd-sign-gate', [maxX - 0.38, 2.5, 1.8], -Math.PI / 2, 2.2, 0.5, 'RAID GATE', [], 4.5)
	);

	// The console and the rack, framed.
	slots.push(
		mesh('dd-rack', 'Weapon Rack', 'box', [RACK[0], 0.5, RACK[2]], [2.5, 1.0, 0.55], '#5d646c', { solid: true }),
		mesh('dd-rack-foot', 'Weapon Rack Foot', 'box', [RACK[0], 0.04, RACK[2]], [2.7, 0.08, 0.7], COLOR.metalDark, { solid: true }),
		mesh('dd-rack-top', 'Weapon Rack Top', 'box', [RACK[0], 0.98, RACK[2]], [2.7, 0.05, 0.7], COLOR.hazard),
		sign('dd-sign-rack', [RACK[0], 2.7, RACK[2] + 0.4], Math.PI, 2.2, 0.5, 'ARMORY', [], 4.5)
	);

	// Things lying about.
	for (const [i, [x, z, w]] of [[-8.8, -2.6, 1.0], [-7.6, -2.8, 0.9], [-8.4, -2.2, 0.8]].entries()) {
		slots.push(mesh(`dd-crate-${i}`, 'Crate', 'box', [x, i === 2 ? 1.2 : w / 2, z], [w, w, w], i % 2 ? '#b8c4ac' : '#d8c3a5', { solid: true, material: i % 2 ? MATERIAL.olive : MATERIAL.planks }));
	}
	for (let i = 0; i < 3; i++) slots.push(mesh(`dd-barrel-${i}`, 'Barrel', 'cylinder', [8.7, 0.5, -2.8 + i * 0.9], [0.8, 1.0, 0.8], i === 1 ? '#d9b8a0' : '#b8c4ac', { solid: true, material: i === 1 ? MATERIAL.rust : MATERIAL.olive }));
	for (let i = 0; i < 5; i++) slots.push(mesh(`dd-sandbag-${i}`, 'Sandbag', 'box', [7.2 + (i % 3) * 0.55, 0.15 + Math.floor(i / 3) * 0.28, -2.6], [0.52, 0.28, 0.3], COLOR.canvas, { solid: true }));
	slots.push(
		sign('dd-poster-0', [-9.88, 2.2, 0.3], Math.PI / 2, 1.1, 1.5, 'KEEP QUIET', ['Every shot is heard.', 'Walls help, but not much.'], 1.5),
		sign('dd-poster-1', [9.88, 2.2, -0.9], -Math.PI / 2, 1.1, 1.5, 'BAGS CAN BE SAVED', ['What a friend dropped', 'can still be carried out.'], 1.5)
	);
	return slots;
}

/** The console: how to play, the squad, and the buttons that send it out. */
export function buildConsole(): Slot[] {
	const root = 'dd-console';
	const [x, , z] = CONSOLE_AT;
	// It turns its back to the arrival point, so its panel is read from there.
	const yaw = Math.atan2(x, z);
	const button = (id: string, text: string, background: string, width: number) =>
		ui(id, 'dd-row', 'button', { width, height: 64, text, fontSize: 28, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background });
	const frame = (id: string, at: Vec3, scale: Vec3) => mesh(id, 'Console Frame', 'box', at, scale, COLOR.metalDark, { parentId: root });
	return [
		// The logical root: the script of the game lives here, and every screen of the bunker hangs below it, so a press on any of them reaches it.
		createSlot({ id: ID.director, name: 'Dead Drop', components: [{ type: 'container' }, { type: 'codeBlock', code: directorScript() }] }),
		createSlot({ id: root, parentId: ID.director, name: 'Console', position: CONSOLE_AT, rotation: yawQuat(yaw), components: [{ type: 'container' }] }),
		// A cabinet below the screen, set back so that it never covers the buttons, a sloped keyboard shelf, and a housing round the screen.
		mesh('dd-console-stand', 'Console Cabinet', 'box', [0, 0.42, 0.2], [1.1, 0.84, 0.6], '#596068', { parentId: root, solid: true }),
		mesh('dd-console-plinth', 'Console Plinth', 'box', [0, 0.04, 0.2], [1.2, 0.08, 0.7], COLOR.metalDark, { parentId: root }),
		mesh('dd-console-shelf', 'Console Shelf', 'box', [0, 0.87, 0.08], [1.1, 0.05, 0.4], COLOR.metalDark, { parentId: root, rotation: [Math.sin(0.12), 0, 0, Math.cos(0.12)] }),
		mesh('dd-console-keys', 'Console Keys', 'box', [0, 0.9, 0.04], [0.8, 0.02, 0.14], COLOR.black, { parentId: root, rotation: [Math.sin(0.12), 0, 0, Math.cos(0.12)] }),
		mesh('dd-console-back', 'Console Back', 'box', [0, 1.28, 0.1], [1.04, 0.86, 0.1], COLOR.metalDark, { parentId: root }),
		mesh('dd-console-led-a', 'Console Light', 'sphere', [-0.46, 0.88, -0.1], [0.04, 0.04, 0.04], COLOR.go, { parentId: root, unlit: true }),
		mesh('dd-console-led-b', 'Console Light', 'sphere', [-0.38, 0.88, -0.1], [0.04, 0.04, 0.04], COLOR.hazard, { parentId: root, unlit: true }),
		frame('dd-console-f0', [0, 1.74, 0.0], [1.08, 0.07, 0.1]),
		frame('dd-console-f1', [0, 0.94, 0.0], [1.08, 0.07, 0.1]),
		frame('dd-console-f2', [-0.52, 1.34, 0.0], [0.07, 0.87, 0.1]),
		frame('dd-console-f3', [0.52, 1.34, 0.0], [0.07, 0.87, 0.1]),
		createSlot({
			id: ID.consolePanel,
			parentId: root,
			name: 'Console Panel',
			position: [0, 1.34, 0],
			components: [{ type: 'uiPanel', width: 620, height: 470, worldWidth: 0.95, background: '#0c0a09' }]
		}),
		ui('dd-title', ID.consolePanel, 'text', { text: 'DEAD DROP', height: 58, fontSize: 44, fontWeight: 'bold', textAlign: 'center', color: NEON.orange }),
		ui('dd-tagline', ID.consolePanel, 'text', { text: 'Get in. Get the loot. Get out.', height: 28, fontSize: 19, textAlign: 'center', color: '#a8a29e' }),
		ui('dd-card', ID.consolePanel, 'container', { width: 560, height: 210, margin: 8, padding: 10, flexDirection: 'column', background: '#1c1917', cornerRadius: 18, borderColor: '#f59e0b', borderWidth: 3 }),
		ui(ID.message, 'dd-card', 'text', { text: 'Take a weapon from the rack and equip it (grip it, then use the radial menu). Then press JOIN.', height: 190, fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: '#f5f5f4' }),
		ui('dd-row', ID.consolePanel, 'container', { width: 560, height: 70, flexDirection: 'row', gap: 10, margin: 4 }),
		button(ID.join, 'JOIN', '#2563eb', 150),
		button(ID.start, 'START RAID', '#16a34a', 270),
		button(ID.leave, 'LEAVE', '#475569', 120)
	];
}
