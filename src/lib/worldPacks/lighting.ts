import type { AssetId } from '@kithin/engine/assets/ref';
import { createSlot, type Slot } from '@kithin/engine/ecs/types';

/** One baked volume of a world: where it is and how finely it is baked. */
export interface LightRegion {
	id: string;
	min: [number, number, number];
	max: [number, number, number];
	voxel: number;
}

/** What a pack's `world.ts` exports as `lighting` so `npm run bake -- <id>` knows what to bake. */
export interface PackLighting {
	regions: LightRegion[];
	/** How the baker sees the sky (0 = none, the default for interiors lit by lamps). */
	skyIntensity?: number;
	/** Scales the colour surfaces bounce, under 1 for less bounced light. */
	albedoScale?: number;
}

/** Where `npm run bake` writes a region of a pack, inside its assets: `asset('lighting/<region>.lvol')`. */
export const bakedLightingPath = (regionId: string) => `lighting/${regionId}.lvol`;

/** A `lightVolume` for every region that has been baked (none before the first `npm run bake -- <id>`). Pass the pack's `ASSETS`. */
export function lightVolumeSlots(assets: Readonly<Record<string, AssetId>>, regions: readonly LightRegion[]): Slot[] {
	return regions.flatMap((region) => {
		const assetId = assets[bakedLightingPath(region.id)];
		return assetId ? [createSlot({ id: `lv-${region.id}`, name: `Lighting ${region.id}`, components: [{ type: 'lightVolume', data: { kind: 'asset', assetId } }] })] : [];
	});
}
