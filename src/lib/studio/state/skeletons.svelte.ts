import type { AssetId } from '$lib/assets/ref';
import { parseGlb } from '$lib/assets/glb';
import { getLocalAssetStore } from '$lib/assets/store';

/**
 * The bone names of the models on this device, for editors that let you pick a bone. Read from the manifest when it
 * recorded them, and from the file itself for models imported before it did. `undefined` means not known (yet).
 */
class Skeletons {
	private known = $state<Record<string, string[] | null>>({});
	private loading = new Set<string>();

	/** The model's bones, `null` if the model has no skeleton, `undefined` while not loaded or not on this device. */
	get(assetId: AssetId | null | undefined): string[] | null | undefined {
		return assetId ? this.known[assetId] : undefined;
	}

	/** Starts reading a model's bones if that has not happened. Safe to call from an effect. */
	async ensure(assetId: AssetId): Promise<void> {
		if (assetId in this.known || this.loading.has(assetId)) return;
		this.loading.add(assetId);
		try {
			const store = getLocalAssetStore();
			const manifest = await store.getManifest(assetId);
			if (!manifest || manifest.type !== 'model') return;
			let joints = manifest.skeleton?.joints;
			if (!joints) {
				const bytes = await store.getBytes(assetId);
				joints = bytes ? parseGlb(bytes).skeleton?.joints : undefined;
			}
			this.known[assetId] = joints && joints.length ? joints : null;
		} catch {
			// unreadable: leave it unknown so the editor falls back to plain text
		} finally {
			this.loading.delete(assetId);
		}
	}
}

export const skeletons = new Skeletons();
