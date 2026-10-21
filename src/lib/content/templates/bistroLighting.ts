import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { BUNDLED_LIGHTING } from '../bundledLighting.ts';
import { HALL, LOBBY, PORCH } from './bistroData.ts';

/** One baked volume of the world: where it is and how finely it is baked. */
export interface LightRegion {
	id: string;
	min: [number, number, number];
	max: [number, number, number];
	voxel: number;
}

/** The name the baked files go by in `BUNDLED_LIGHTING`. */
export const LIGHTING_WORLD = 'bistro-rush';
/** How the baker is asked to see the world: no sky (the windows are lamps), and surfaces that bounce a little less than their colours say. */
export const BAKE = { skyIntensity: 0, albedoScale: 0.7 } as const;

/**
 * The lobby is one volume and the hall, with the porch behind its street door, another. The hall is baked empty: what a
 * restaurant puts in it (appliances, tables, the half wall, the hoardings) is moved in by the script and takes its light from
 * where it stands.
 */
export const LIGHT_REGIONS: LightRegion[] = [
	{ id: 'lobby', min: [LOBBY.minX - 0.4, -0.1, LOBBY.minZ - 0.4], max: [LOBBY.maxX + 0.4, LOBBY.height + 0.3, LOBBY.maxZ + 0.1], voxel: 0.25 },
	{ id: 'hall', min: [HALL.minX - 0.4, -0.1, LOBBY.maxZ + 0.1], max: [HALL.minX + HALL.w + 0.4, HALL.height + 0.3, PORCH.maxZ + 0.4], voxel: 0.25 }
];

export const lightVolumeId = (region: string): string => `bi-lv-${region}`;

/** The `lightVolume` of every region that has been baked (none before the first `npm run bake -- bistro-rush`). */
export function buildLighting(): Slot[] {
	const slots: Slot[] = [];
	for (const region of LIGHT_REGIONS) {
		const baked = BUNDLED_LIGHTING[`${LIGHTING_WORLD}/${region.id}`];
		if (!baked) continue;
		slots.push(createSlot({ id: lightVolumeId(region.id), name: `Lighting ${region.id}`, components: [{ type: 'lightVolume', data: { kind: 'asset', assetId: baked.assetId } }] }));
	}
	return slots;
}
