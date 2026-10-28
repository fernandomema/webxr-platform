import { fileURLToPath } from 'node:url';
import { contentAssetIdIfPresent } from '@kithin/engine/assets/contentFolder';
import type { AssetId } from '@kithin/engine/assets/ref';

const CONTENT = fileURLToPath(new URL('../../static/content/', import.meta.url));

/** The asset id of the baked lighting of a region (`lobby`, `map-3`…), the hash of its file in `static/content` (written by `npm run bake`), or null before it has been baked. */
export const bakedVolume = (region: string): AssetId | null => contentAssetIdIfPresent(`lighting-${region}.lvol`, CONTENT);
