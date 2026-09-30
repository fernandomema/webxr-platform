import { importGlb } from '$lib/assets/importGlb';
import { getLocalAssetStore } from '$lib/assets/store';
import type { SlotTree } from '$lib/ecs/types';
import { buildAvatarTree } from './build';

const BASE_AVATAR_URL = '/avatars/base.glb';

let cached: Promise<SlotTree | null> | null = null;

/**
 * The avatar everyone wears until they choose one. Its model ships with the app; importing it into the
 * local asset store gives it the same content address on every device, so it travels to guests like any
 * other model. Resolves to null if it cannot be loaded (the ghost stand-in is used then).
 */
export function loadBaseAvatar(): Promise<SlotTree | null> {
	cached ??= (async () => {
		try {
			const response = await fetch(BASE_AVATAR_URL);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const { manifest } = await importGlb(new Uint8Array(await response.arrayBuffer()), 'Base avatar', getLocalAssetStore());
			if (manifest.type !== 'model') return null;
			return buildAvatarTree({ assetId: manifest.assetId, name: 'Avatar', joints: manifest.skeleton?.joints ?? [], bounds: manifest.bounds });
		} catch (error) {
			console.warn('[avatar] the base avatar could not be loaded', error);
			return null;
		}
	})();
	return cached;
}
