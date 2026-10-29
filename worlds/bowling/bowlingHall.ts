import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { asset } from './assets.ts';
import { BOWLING, HALL, JUKEBOX_AT, LANE_COUNT } from './bowlingLayout.ts';
import { box, cylinder, group, pitch, pointLight, sign, yaw, type Surface, type Vec3 } from './bowlingParts.ts';

/** What the surfaces of the alley are made of: Poly Haven textures (CC0) kept in the pack. */
export const SURFACES = {
	carpet: { albedo: asset('textures/carpet-diff.jpg'), normal: asset('textures/carpet-nor.jpg'), size: 2, roughness: 0.95 } satisfies Surface,
	lane: { albedo: asset('textures/lane-diff.jpg'), normal: asset('textures/lane-nor.jpg'), arm: asset('textures/lane-arm.jpg'), size: 1.2, roughness: 0.3 } satisfies Surface,
	wood: { albedo: asset('textures/bar-diff.jpg'), size: 1.4, roughness: 0.45 } satisfies Surface,
	paneling: { albedo: asset('textures/wall-diff.jpg'), size: 1.6, roughness: 0.7 } satisfies Surface
};

const MAGENTA = '#ff2fb3';
const CYAN = '#25e6ff';
const AMBER = '#ffb347';
const WALL = '#17122e';
const MID = (HALL.minZ + HALL.maxZ) / 2;
const LENGTH = HALL.maxZ - HALL.minZ;

/** The sky is only there so that nothing outside is bright; the alley is lit by its own lamps and neon. */
function buildSky(): Slot[] {
	return [
		createSlot({ id: 'bw-sky', name: 'Sky', components: [{ type: 'skybox', topColor: '#05040c', horizonColor: '#0a0818', bottomColor: '#030308', ambientIntensity: 0.55 }] }),
		createSlot({ id: 'bw-spawn', name: 'Spawn', position: [...BOWLING.spawn] as Vec3, components: [{ type: 'spawnPoint' }] })
	];
}

/** Floors, walls and ceiling. The floor is cut where the lane block is, so that the lanes and gutters can sit below the carpet. */
function buildShell(): Slot[] {
	const { blockMinX: bx0, blockMaxX: bx1, foulZ } = BOWLING;
	const floor = (id: string, name: string, x0: number, x1: number, z0: number, z1: number, color: string, surface?: Surface) =>
		box(id, name, [(x0 + x1) / 2, -0.05, (z0 + z1) / 2], [x1 - x0, 0.1, z1 - z0], color, { solid: true, surface });
	const slots: Slot[] = [
		floor('bw-floor-lobby', 'Lobby Floor', HALL.minX, HALL.maxX, HALL.minZ, foulZ, '#2a2a22', SURFACES.carpet),
		floor('bw-floor-west', 'West Aisle', HALL.minX, bx0, foulZ, HALL.maxZ, '#2a2a22', SURFACES.carpet),
		floor('bw-floor-east', 'East Aisle', bx1, HALL.maxX, foulZ, HALL.maxZ, '#2a2a22', SURFACES.carpet),
		// The approach: the wood players stand on to throw, in front of the foul line.
		box('bw-approach', 'Approach', [0, 0.003, (BOWLING.approachStartZ + foulZ) / 2], [bx1 - bx0, 0.006, foulZ - BOWLING.approachStartZ], '#c8995a', { surface: { ...SURFACES.lane, size: 1.6 } }),
		box('bw-ceiling', 'Ceiling', [0, HALL.height + 0.1, MID], [HALL.maxX - HALL.minX + 0.6, 0.2, LENGTH + 0.6], '#0b0a16', { solid: true }),
		box('bw-wall-west', 'West Wall', [HALL.minX - 0.15, HALL.height / 2, MID], [0.3, HALL.height, LENGTH], WALL, { solid: true }),
		box('bw-wall-east', 'East Wall', [HALL.maxX + 0.15, HALL.height / 2, MID], [0.3, HALL.height, LENGTH], WALL, { solid: true }),
		box('bw-wall-lobby', 'Lobby Wall', [0, HALL.height / 2, HALL.minZ - 0.15], [HALL.maxX - HALL.minX + 0.6, HALL.height, 0.3], WALL, { solid: true }),
		box('bw-wall-end', 'End Wall', [0, HALL.height / 2, HALL.maxZ + 0.15], [HALL.maxX - HALL.minX + 0.6, HALL.height, 0.3], '#0e0a1e', { solid: true }),
		// Wainscot: dark wood up to the neon line.
		box('bw-panel-west', 'West Paneling', [HALL.minX + 0.03, 0.55, MID], [0.06, 1.1, LENGTH], '#6b5545', { surface: SURFACES.paneling }),
		box('bw-panel-east', 'East Paneling', [HALL.maxX - 0.03, 0.55, MID], [0.06, 1.1, LENGTH], '#6b5545', { surface: SURFACES.paneling }),
		box('bw-panel-lobby', 'Lobby Paneling', [0, 0.55, HALL.minZ + 0.03], [HALL.maxX - HALL.minX, 1.1, 0.06], '#6b5545', { surface: SURFACES.paneling }),
		// Neon lines round the hall.
		box('bw-neon-west', 'West Neon', [HALL.minX + 0.05, 1.18, MID], [0.05, 0.05, LENGTH], MAGENTA, { unlit: true }),
		box('bw-neon-east', 'East Neon', [HALL.maxX - 0.05, 1.18, MID], [0.05, 0.05, LENGTH], CYAN, { unlit: true }),
		box('bw-neon-lobby', 'Lobby Neon', [0, 1.18, HALL.minZ + 0.05], [HALL.maxX - HALL.minX, 0.05, 0.05], AMBER, { unlit: true }),
		box('bw-neon-ceiling-west', 'Ceiling Neon West', [HALL.minX + 0.4, HALL.height - 0.05, MID], [0.08, 0.05, LENGTH], MAGENTA, { unlit: true }),
		box('bw-neon-ceiling-east', 'Ceiling Neon East', [HALL.maxX - 0.4, HALL.height - 0.05, MID], [0.08, 0.05, LENGTH], CYAN, { unlit: true })
	];
	// Light strips over the lanes: a long one over the middle of every lane.
	for (let lane = 0; lane < LANE_COUNT; lane++) {
		slots.push(box(`bw-strip-${lane}`, `Lane ${lane + 1} Strip`, [BOWLING.laneX[lane], HALL.height - 0.05, (foulZ + HALL.maxZ) / 2], [0.12, 0.05, HALL.maxZ - foulZ - 2], '#cfe6ff', { unlit: true }));
	}
	return slots;
}

/** The big signs: the name of the alley over the pins, the welcome and the rules by the door. */
function buildSigns(): Slot[] {
	const faceViewer = (towardX: number, towardZ: number) => yaw(Math.atan2(towardX, towardZ));
	return [
		sign('bw-sign-name', 'Alley Name', [0, 3.5, HALL.maxZ - 0.08], [10, 1.9], { title: 'NEON PIN LANES', titleColor: '#ff58d6', lines: ['OPEN LATE  ·  EVERY GAME A STRIKE'], lineColor: '#7df3ff', background: '#08051a', scale: 1.3 }),
		box('bw-sign-name-frame', 'Alley Name Frame', [0, 3.5, HALL.maxZ - 0.04], [10.3, 2.2, 0.05], MAGENTA, { unlit: true }),
		sign('bw-sign-welcome', 'Welcome', [0, 3.1, HALL.minZ + 0.08], [7, 1.2], { title: 'WELCOME', titleColor: '#facc15', lines: ['Grab a ball  ·  Roll it down the lane'], lineColor: '#ffffff', background: '#10102a' }, { rotation: yaw(Math.PI) }),
		// How to play, on a post in front of the arrival point.
		cylinder('bw-howto-post', 'How To Post', [0.0, 0.7, -5.2], 0.08, 1.4, '#2f2f3a'),
		sign('bw-howto', 'How To Play', [0, 1.75, -5.2], [1.5, 1.05], {
			title: 'HOW TO PLAY',
			titleColor: '#facc15',
			lines: ['1  Take a ball from a return', '2  Stand on the approach', '3  Swing and let go down the lane', '4  Press JOIN at a desk to add friends', 'Bumpers and aim help are on the desk'],
			lineSizes: [1, 0.82, 0.82, 0.82, 0.82],
			background: '#10102a',
			scale: 0.9
		}),
		sign('bw-sign-rules', 'Rules', [HALL.maxX - 0.08, 2.3, -11], [2.4, 1.2], { title: 'HOUSE RULES', titleColor: '#25e6ff', lines: ['Strike  =  10 + the next two balls', 'Spare  =  10 + the next ball', 'Ten frames  ·  300 is perfect'], background: '#0d1030' }, { rotation: yaw(Math.PI / 2) }),
		sign('bw-sign-bar', 'Bar Sign', [HALL.minX + 0.08, 2.9, -8.5], [2.6, 0.7], { title: 'THE SPARE ROOM', titleColor: '#ff58d6', lines: [], background: '#00000000' }, { rotation: yaw(-Math.PI / 2) }),
		sign('bw-sign-shoes', 'Shoe Rental Sign', [0, 2.2, HALL.minZ + 0.7], [2.2, 0.55], { title: 'SHOES', titleColor: '#ffb347', lines: [], background: '#00000000' }, { rotation: faceViewer(0, -1) })
	];
}

/** The Hall of Fame board in the lobby, filled by the script from the leaderboard. */
function buildHallOfFame(): Slot[] {
	return [
		box('bw-hall-frame', 'Hall Of Fame Frame', [HALL.maxX - 0.04, 2.6, -6.2], [0.06, 2.45, 4.2], '#2a3a78'),
		createSlot({
			id: BOWLING.hallOfFameBoard,
			name: 'Hall Of Fame',
			position: [HALL.maxX - 0.09, 2.6, -6.2],
			rotation: yaw(Math.PI / 2),
			scale: [4.0, 2.333, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' },
				{ type: 'scoreboard', title: 'HALL OF FAME', status: 'Best games in this alley', columns: ['Score'], rows: [] }
			]
		})
	];
}

/** The bar on the west wall, the shoe counter at the back and the booths under the east wall. */
function buildLounge(): Slot[] {
	const slots: Slot[] = [];
	const wood = '#5a3626';
	// The bar: a counter with stools in front and a lit shelf of bottles behind.
	slots.push(group('bw-bar', 'Bar', [0, 0, 0]));
	slots.push(box('bw-bar-body', 'Bar Counter', [-8.1, 0.55, -8.5], [0.9, 1.1, 7.6], '#2a1a14', { parentId: 'bw-bar', solid: true }));
	slots.push(box('bw-bar-top', 'Bar Top', [-8.05, 1.13, -8.5], [1.15, 0.07, 7.8], wood, { parentId: 'bw-bar', surface: SURFACES.wood }));
	slots.push(box('bw-bar-foot', 'Bar Foot Rail', [-7.5, 0.25, -8.5], [0.05, 0.05, 7.4], '#c9a05a', { parentId: 'bw-bar' }));
	slots.push(box('bw-bar-shelf', 'Back Bar', [-9.55, 1.1, -8.5], [0.5, 2.2, 7.6], '#1b1210', { parentId: 'bw-bar', solid: true }));
	slots.push(box('bw-bar-glow', 'Back Bar Glow', [-9.28, 2.45, -8.5], [0.04, 0.06, 7.4], AMBER, { parentId: 'bw-bar', unlit: true }));
	const bottle = ['#34d399', '#f59e0b', '#60a5fa', '#f472b6', '#a78bfa', '#fbbf24'];
	for (let i = 0; i < 12; i++) {
		const z = -11.6 + i * 0.58;
		slots.push(cylinder(`bw-bottle-${i}`, 'Bottle', [-9.3, i % 2 ? 1.52 : 1.9, z], 0.09, i % 2 ? 0.26 : 0.32, bottle[i % bottle.length], { parentId: 'bw-bar', opacity: 0.85 }));
	}
	for (let i = 0; i < 6; i++) {
		const z = -11.2 + i * 1.28;
		slots.push(cylinder(`bw-stool-pole-${i}`, 'Stool Pole', [-6.85, 0.34, z], 0.07, 0.68, '#8d96a3', { parentId: 'bw-bar' }));
		slots.push(cylinder(`bw-stool-seat-${i}`, 'Stool Seat', [-6.85, 0.72, z], 0.4, 0.09, i % 2 ? MAGENTA : CYAN, { parentId: 'bw-bar', solid: true }));
		slots.push(cylinder(`bw-stool-base-${i}`, 'Stool Base', [-6.85, 0.02, z], 0.34, 0.04, '#6b7280', { parentId: 'bw-bar' }));
	}
	slots.push(pointLight('bw-light-bar', 'Bar Light', [-8.4, 2.6, -8.5], '#ffb066', 2.2, 8, false));

	// Shoe rental counter at the back wall.
	slots.push(group('bw-shoes', 'Shoe Counter', [0, 0, 0]));
	slots.push(box('bw-shoes-body', 'Counter', [0, 0.52, HALL.minZ + 1.4], [4.2, 1.04, 0.8], '#2a1a14', { parentId: 'bw-shoes', solid: true }));
	slots.push(box('bw-shoes-top', 'Counter Top', [0, 1.06, HALL.minZ + 1.4], [4.4, 0.06, 1.0], wood, { parentId: 'bw-shoes', surface: SURFACES.wood }));
	slots.push(box('bw-shoes-wall', 'Shoe Wall', [0, 1.6, HALL.minZ + 0.2], [6.4, 2.6, 0.2], '#150f24', { parentId: 'bw-shoes' }));
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 9; col++) {
			const x = -2.8 + col * 0.7;
			const y = 0.7 + row * 0.75;
			const pair = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#a855f7'][(row * 3 + col) % 5];
			slots.push(box(`bw-shoe-${row}-${col}`, 'Shoes', [x, y, HALL.minZ + 0.42], [0.5, 0.2, 0.3], pair, { parentId: 'bw-shoes' }));
		}
	}

	// Three booths under the east wall.
	for (let i = 0; i < 3; i++) {
		const z = -11.4 + i * 2.5;
		const vinyl = i % 2 ? '#0f766e' : '#b4235a';
		const id = `bw-booth-${i}`;
		slots.push(group(id, 'Booth', [0, 0, 0]));
		slots.push(box(`${id}-table`, 'Booth Table', [8.45, 0.74, z], [0.9, 0.05, 1.3], wood, { parentId: id, surface: SURFACES.wood }));
		slots.push(box(`${id}-leg`, 'Booth Table Leg', [8.45, 0.37, z], [0.12, 0.74, 0.12], '#9aa4b2', { parentId: id }));
		slots.push(box(`${id}-seat-a`, 'Booth Seat', [7.5, 0.25, z], [0.55, 0.5, 1.5], vinyl, { parentId: id, solid: true }));
		slots.push(box(`${id}-back-a`, 'Booth Back', [7.25, 0.75, z], [0.1, 0.55, 1.5], vinyl, { parentId: id }));
		slots.push(box(`${id}-seat-b`, 'Booth Seat', [9.4, 0.25, z], [0.55, 0.5, 1.5], vinyl, { parentId: id, solid: true }));
		slots.push(box(`${id}-back-b`, 'Booth Back', [9.65, 0.75, z], [0.1, 0.55, 1.5], vinyl, { parentId: id }));
	}
	return slots;
}

/** Tables with stools along both aisles, where the people who are not bowling watch the lanes. */
function buildSpectators(): Slot[] {
	const slots: Slot[] = [];
	for (const side of [-1, 1] as const) {
		for (let i = 0; i < 2; i++) {
			const x = side * 7.7;
			const z = 9 + i * 7;
			const id = `bw-spec-${side < 0 ? 'w' : 'e'}${i}`;
			slots.push(group(id, 'Spectator Table', [0, 0, 0]));
			slots.push(cylinder(`${id}-top`, 'Table Top', [x, 1.0, z], 1.0, 0.05, '#2a1a14', { parentId: id, surface: SURFACES.wood }));
			slots.push(cylinder(`${id}-pole`, 'Table Pole', [x, 0.5, z], 0.1, 1.0, '#8d96a3', { parentId: id, solid: true }));
			slots.push(cylinder(`${id}-base`, 'Table Base', [x, 0.02, z], 0.6, 0.04, '#6b7280', { parentId: id }));
			slots.push(cylinder(`${id}-glow`, 'Table Glow', [x, 1.03, z], 0.18, 0.01, side < 0 ? MAGENTA : CYAN, { parentId: id, unlit: true }));
			for (const [k, dz] of [[0, -0.85], [1, 0.85]] as const) {
				slots.push(cylinder(`${id}-stool-${k}`, 'Stool', [x, 0.5, z + dz], 0.38, 0.08, side < 0 ? MAGENTA : CYAN, { parentId: id, solid: true }));
				slots.push(cylinder(`${id}-stool-pole-${k}`, 'Stool Pole', [x, 0.25, z + dz], 0.06, 0.5, '#8d96a3', { parentId: id }));
			}
		}
	}
	return slots;
}

/** The jukebox against the east wall by the approach: the body and its glow. Its panel and script are in bowlingLanes.ts with the other controls. */
function buildJukebox(): Slot[] {
	const { x, z } = JUKEBOX_AT;
	return [
		group('bw-jukebox-model', 'Jukebox', [0, 0, 0]),
		box('bw-juke-body', 'Jukebox Body', [x, 0.8, z], [0.7, 1.6, 1.1], '#3a1230', { parentId: 'bw-jukebox-model', solid: true }),
		cylinder('bw-juke-arch', 'Jukebox Arch', [x, 1.62, z], 0.9, 0.7, '#3a1230', { parentId: 'bw-jukebox-model', rotation: pitch(Math.PI / 2), solid: true }),
		box('bw-juke-glow-a', 'Jukebox Glow', [x - 0.36, 1.0, z], [0.02, 0.9, 0.85], '#ff7a3d', { parentId: 'bw-jukebox-model', unlit: true }),
		box('bw-juke-glow-b', 'Jukebox Trim', [x - 0.36, 1.62, z], [0.02, 0.22, 0.85], CYAN, { parentId: 'bw-jukebox-model', unlit: true }),
		pointLight('bw-light-juke', 'Jukebox Light', [x - 1.1, 1.6, z], '#ff7a3d', 1.6, 6, false)
	];
}

export function buildHall(): Slot[] {
	return [...buildSky(), ...buildShell(), ...buildSigns(), ...buildHallOfFame(), ...buildLounge(), ...buildSpectators(), ...buildJukebox()];
}
