import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { BUNDLED_LIGHTING } from '../bundledLighting.ts';
import { GRID } from './deadDropData.ts';
import { HUB_ROOM } from './deadDropHub.ts';
import { cellCenter } from './deadDropKit.ts';

/** One baked volume of the world: where it is and how finely it is baked. */
export interface LightRegion {
	id: string;
	min: [number, number, number];
	max: [number, number, number];
	voxel: number;
}

const { cell: C, size: N, wallHeight: H } = GRID;

/** The name the baked files go by in `BUNDLED_LIGHTING`. */
export const LIGHTING_WORLD = 'dead-drop';

/** The bunker is one volume; the raid is one per room, baked with every doorway shut (the walls are always there, the doorways are switched on). */
export const LIGHT_REGIONS: LightRegion[] = [
	{ id: 'hub', min: [HUB_ROOM.minX - 0.4, -0.1, HUB_ROOM.minZ - 0.4], max: [HUB_ROOM.maxX + 0.4, HUB_ROOM.height + 0.3, HUB_ROOM.maxZ + 0.4], voxel: 0.25 },
	...Array.from({ length: N * N }, (_, i): LightRegion => {
		const cx = i % N, cz = Math.floor(i / N);
		const [x, , z] = cellCenter(cx, cz);
		return { id: `room-${cx}${cz}`, min: [x - C / 2 - 0.4, -0.1, z - C / 2 - 0.4], max: [x + C / 2 + 0.4, H + 0.3, z + C / 2 + 0.4], voxel: 0.25 };
	})
];

export const lightVolumeId = (region: string): string => `dd-lv-${region}`;

/** The `lightVolume` of every region that has been baked (none before the first `npm run bake`). */
export function buildLighting(): Slot[] {
	const slots: Slot[] = [];
	for (const region of LIGHT_REGIONS) {
		const baked = BUNDLED_LIGHTING[`${LIGHTING_WORLD}/${region.id}`];
		if (!baked) continue;
		slots.push(createSlot({ id: lightVolumeId(region.id), name: `Lighting ${region.id}`, components: [{ type: 'lightVolume', data: { kind: 'asset', assetId: baked.assetId }, ...(region.id === 'hub' ? { tint: '#dfe0c8' } : {}) }] }));
	}
	return slots;
}
