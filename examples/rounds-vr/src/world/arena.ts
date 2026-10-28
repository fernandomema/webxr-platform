import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { ARENA, HUMAN, HUMAN_GRAVITY, HUMAN_JUMP_SPEED, LOBBY, MAPS, MOVEMENT, TEAM, type Vec3 } from './data.ts';
import { ID, mesh, yawQuat } from './kit.ts';
import { LOBBY_SKY, styleOf } from './style.ts';
import { mapFragmentAsset } from './fragments.ts';
import { bakedVolume } from './lighting.ts';

/** A flat sign: a plane with text. `yaw` turns it; with 0 the text reads from the −Z side, looking toward +Z. */
export function sign(id: string, name: string, position: Vec3, size: [number, number], yaw: number, title: string, lines: string[], options: { color?: string; scale?: number; verticalAlign?: 'top' | 'middle'; parentId?: string } = {}): Slot {
	const color = options.color ?? '#0b1020';
	return createSlot({
		id,
		name,
		parentId: options.parentId ?? null,
		position,
		rotation: yawQuat(yaw),
		scale: [size[0], size[1], 1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color },
			{ type: 'textDisplay', title, lines, color, ...(options.scale === undefined ? {} : { scale: options.scale }), ...(options.verticalAlign ? { verticalAlign: options.verticalAlign } : {}) }
		]
	});
}

/**
 * What a map is in the world: one slot that builds the map's fragment (its blocks and lights; see `fragments.ts`) while it is on, and its
 * baked lighting, which is on with it. Only the map in play is built.
 */
function buildMapGroups(): Slot[] {
	const slots: Slot[] = [];
	MAPS.forEach((map, m) => {
		const style = styleOf(m);
		const root = ID.map(m);
		const group = createSlot({ id: root, name: `${map.name} (${style.place})`, components: [{ type: 'fragment', source: { kind: 'asset', assetId: mapFragmentAsset(m) } }] });
		slots.push(m === 0 ? group : { ...group, disabled: true });
		const baked = bakedVolume(`map-${m}`);
		if (baked) slots.push(createSlot({ id: `${root}-lighting`, parentId: root, name: 'Map Lighting', components: [{ type: 'lightVolume', data: { kind: 'asset', assetId: baked }, intensity: 1.35 }] }));
	});
	return slots;
}

/** The emblem behind each glass end: rings in the colour of the side, like the rounds of the game. */
function buildEmblems(): Slot[] {
	const slots: Slot[] = [];
	const y = (ARENA.minY + ARENA.maxY) / 2 + 2;
	TEAM.forEach((team, side) => {
		const x = (side === 0 ? -1 : 1) * (ARENA.halfX + 1.2);
		const rings: [number, string][] = [[10, team.dark], [8, team.color], [6, team.dark], [4, team.color], [2, '#ffffff']];
		rings.forEach(([radius, color], n) => {
			slots.push(mesh(`rd-emblem-${side}-${n}`, `${team.name} Emblem`, 'cylinder', [x + (side === 0 ? -1 : 1) * n * 0.05, y, 0], [radius * 2, 0.1, radius * 2], color, { unlit: true, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }));
		});
	});
	return slots;
}

/** The arena: sky, the walls that keep everyone in the plane, the emblems, the skyline, and every map. */
export function buildArena(): Slot[] {
	const { halfX, depth, minY, maxY } = ARENA;
	const height = maxY - minY, midY = (maxY + minY) / 2;
	const wall = (id: string, position: Vec3, scale: Vec3, opacity: number, color: string, unlit = false) =>
		mesh(id, 'Wall', 'box', position, scale, color, { solid: true, opacity, unlit });
	return [
		createSlot({
			id: 'rd-sky',
			name: 'Sky',
			components: [
				{ type: 'skybox', topColor: LOBBY_SKY.top, horizonColor: LOBBY_SKY.horizon, bottomColor: LOBBY_SKY.bottom, stars: LOBBY_SKY.stars, ambientIntensity: LOBBY_SKY.ambient, toneMapping: 'aces', exposure: LOBBY_SKY.exposure, contrast: LOBBY_SKY.contrast, saturation: LOBBY_SKY.saturation, bloom: LOBBY_SKY.bloom },
				{ type: 'worldSettings', lighting: 'baked', description: 'A duel in 3D and VR: shoot, block, and after every round shoot a card to get stronger.' },
				// The body of a player: the game's own jump and run (see `HUMAN`), kept in the plane of the fight, and a wall that is jumped off to climb it.
				{
					type: 'characterController',
					walkSpeed: HUMAN.runSpeed,
					runSpeed: HUMAN.runSpeed,
					jumpSpeed: HUMAN_JUMP_SPEED,
					gravity: HUMAN_GRAVITY,
					coyoteTime: 0.12,
					jumpBuffer: 0.12,
					airJumps: 0,
					wallJump: true,
					wallJumpUp: MOVEMENT.wallJumpUp,
					wallJumpOut: HUMAN_JUMP_SPEED * MOVEMENT.wallJumpOut,
					wallSlideSpeed: 1.6,
					airControl: MOVEMENT.airControl,
					slopeLimit: MOVEMENT.groundAngle,
					vrJump: true,
					laneAxis: 'z',
					laneCenter: 0,
					laneWidth: ARENA.depth
				}
			]
		}),
		createSlot({ id: ID.spawn, name: 'Spawn', position: LOBBY.spawn, components: [{ type: 'spawnPoint' }] }),
		// The two walls that keep everyone within the depth of the map are invisible: it is a side view with a little depth.
		wall('rd-depth-n', [0, midY, depth / 2 + 0.25], [halfX * 2 + 1, height, 0.5], 0, '#000000'),
		wall('rd-depth-s', [0, midY, -depth / 2 - 0.25], [halfX * 2 + 1, height, 0.5], 0, '#000000'),
		// The ends are glass, with a bright edge.
		wall('rd-end-w', [-halfX - 0.25, midY, 0], [0.5, height, depth + 1], 0.3, '#1e1b4b'),
		wall('rd-end-e', [halfX + 0.25, midY, 0], [0.5, height, depth + 1], 0.3, '#1e1b4b'),
		// The ceiling is invisible too: a jump goes as high as the screen does.
		wall('rd-ceiling', [0, maxY + 0.25, 0], [halfX * 2 + 1, 0.5, depth + 1], 0, '#000000'),
		// Where each fighter starts: a pad the script puts under their feet.
		...TEAM.flatMap((team, side) => [
			mesh(ID.pad(side), `${team.name} Pad`, 'disc', [0, -200, 0], [1.9, 1, 1.9], team.color, { unlit: true, opacity: 0.85 }),
			mesh(ID.padRing(side), `${team.name} Pad Ring`, 'disc', [0, -200, 0], [2.4, 1, 2.4], '#ffffff', { unlit: true, opacity: 0.35 })
		]),
		mesh('rd-edge-w', 'Edge', 'box', [-halfX, midY, 0], [0.06, height, 0.06], TEAM[0].color, { unlit: true }),
		mesh('rd-edge-e', 'Edge', 'box', [halfX, midY, 0], [0.06, height, 0.06], TEAM[1].color, { unlit: true }),
		...buildEmblems(),
		...buildMapGroups()
	];
}
