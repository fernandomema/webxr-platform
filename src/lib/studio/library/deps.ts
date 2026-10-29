import type { AssetProvenance } from '@kithin/engine/library/provenance';
import { optimizeAudio } from '../content/audioOptimize';
import { optimizeGlb } from '../content/glbOptimize';
import { optimizeImage, packArmMaps, PICTURE_PRESET, TEXTURE_PRESETS } from '../content/imageOptimize';
import { studioAssets } from '../state/models.svelte';
import { downloadLibraryFile } from './client';
import type { ImportDeps } from './importers';

/** The browser's way of doing what the importers ask: the library routes, the image optimizer and this device's asset store. */
export const browserImportDeps: ImportDeps = {
	download: (ref, variantId, role, index, signal) => downloadLibraryFile(ref, variantId, role, index, signal),
	optimizeMap: (bytes, map) => optimizeImage(bytes, TEXTURE_PRESETS[map]),
	packArm: (maps) => packArmMaps(maps, TEXTURE_PRESETS.arm),
	store: (bytes, fileName, type, provenance: AssetProvenance) => studioAssets.importBytes(bytes, fileName, type, provenance),
	optimizeFile: async (kind, bytes) => {
		if (kind === 'model') {
			const result = await optimizeGlb(bytes, (image, role) => optimizeImage(image, TEXTURE_PRESETS[role]));
			return result.converted ? { bytes: result.bytes, extension: 'glb' } : null;
		}
		if (kind === 'image') {
			const result = await optimizeImage(bytes, PICTURE_PRESET);
			return result.mimeType === 'image/webp' ? { bytes: result.bytes, extension: 'webp' } : null;
		}
		const result = await optimizeAudio(bytes);
		return { bytes: result.bytes, extension: result.format };
	}
};
