import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, ui, uiPanel } from './arcadeKit.ts';
import type { Vec3 } from './arcadeKit.ts';

/** The hall of the Arcade world: x from -13 to 13 and z from -4 to 17, with the players arriving at the south end looking north. */
export const ROOM = { minX: -13, maxX: 13, minZ: -4, maxZ: 17, height: 4.4 } as const;

const WALL = '#150b2e';

const wall = (id: string, name: string, at: Vec3, scale: Vec3): Slot => box(id, name, at, scale, WALL, {}, true);

/** A thin bar of light along a wall. */
const strip = (id: string, at: Vec3, scale: Vec3, color: string): Slot =>
	createSlot({ id, name: 'Neon Strip', position: at, scale, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color, unlit: true }] });

export function buildArcadeRoom(): Slot[] {
	const { minX, maxX, minZ, maxZ, height } = ROOM;
	const width = maxX - minX;
	const depth = maxZ - minZ;
	const midX = (minX + maxX) / 2;
	const midZ = (minZ + maxZ) / 2;
	return [
		createSlot({
			id: 'arcade-sky',
			name: 'Sky',
			components: [{ type: 'skybox', topColor: '#0b0618', horizonColor: '#241046', bottomColor: '#05030c', stars: 0.5, ambientIntensity: 0.9 }]
		}),
		createSlot({
			id: 'arcade-spawn',
			name: 'Spawn Point',
			position: [0, 0, 0],
			components: [{ type: 'spawnPoint' }]
		}),
		createSlot({
			id: 'arcade-floor',
			name: 'Floor',
			position: [midX, -0.05, midZ],
			scale: [width / 20, 1, depth / 20],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#1a1033' }, { type: 'collider', shape: 'box' }]
		}),
		wall('arcade-wall-n', 'North Wall', [midX, height / 2, maxZ + 0.1], [width + 0.4, height, 0.2]),
		wall('arcade-wall-s', 'South Wall', [midX, height / 2, minZ - 0.1], [width + 0.4, height, 0.2]),
		wall('arcade-wall-w', 'West Wall', [minX - 0.1, height / 2, midZ], [0.2, height, depth]),
		wall('arcade-wall-e', 'East Wall', [maxX + 0.1, height / 2, midZ], [0.2, height, depth]),
		box('arcade-ceiling', 'Ceiling', [midX, height + 0.1, midZ], [width + 0.4, 0.2, depth + 0.4], '#0b0618'),
		strip('arcade-strip-n', [midX, 3.95, maxZ - 0.02], [width, 0.06, 0.03], NEON.pink),
		strip('arcade-strip-w', [minX + 0.02, 3.95, midZ], [0.03, 0.06, depth], NEON.cyan),
		strip('arcade-strip-e', [maxX - 0.02, 3.95, midZ], [0.03, 0.06, depth], NEON.violet),
		strip('arcade-strip-s', [midX, 3.95, minZ + 0.02], [width, 0.06, 0.03], NEON.yellow),
		strip('arcade-skirt-n', [midX, 0.05, maxZ - 0.02], [width, 0.06, 0.03], NEON.cyan),
		strip('arcade-skirt-w', [minX + 0.02, 0.05, midZ], [0.03, 0.06, depth], NEON.pink),
		strip('arcade-skirt-e', [maxX - 0.02, 0.05, midZ], [0.03, 0.06, depth], NEON.pink),
		box('arcade-rug', 'Rug', [0, 0.004, 8], [5, 0.008, 6], '#312e81'),
		box('arcade-rug-edge', 'Rug Edge', [0, 0.006, 8], [4.6, 0.008, 5.6], '#1e1b4b'),
		createSlot({ id: 'arcade-light-0', name: 'Ceiling Light', position: [-6, 4.1, 7], components: [{ type: 'pointLight', color: '#c4b5fd', intensity: 1.1, range: 16 }] }),
		createSlot({ id: 'arcade-light-1', name: 'Ceiling Light', position: [6, 4.1, 7], components: [{ type: 'pointLight', color: '#a5f3fc', intensity: 1.1, range: 16 }] }),
		createSlot({
			id: 'arcade-welcome',
			name: 'Welcome Sign',
			position: [0, 2.7, 3.4],
			scale: [3.2, 1.5, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0b0618' },
				{
					type: 'textDisplay',
					title: 'THE ARCADE',
					lines: ['Darts, air hockey, basketball,', 'ring toss, whack-a-mole and strength.', 'Every machine plays alone (1 PLAYER) or with friends (VERSUS).'],
					color: '#0b0618',
					scale: 0.8
				}
			]
		}),
		uiPanel('arcade-lobby-link', 'Back to the Lobby', [3.2, 1.4, 2.2], 320, 120, 0.8, '#0a0f22', [{ type: 'worldLink', target: { kind: 'builtin', id: 'lobby' }, label: 'Lobby' }]),
		ui('arcade-lobby-link-text', 'arcade-lobby-link', 'text', { text: 'BACK TO THE LOBBY', height: 100, width: 300, fontSize: 30, fontWeight: 'bold', textAlign: 'center', color: '#c4b5fd' })
	];
}
