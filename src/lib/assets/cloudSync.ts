import { cloudAssets } from './cloud.ts';
import { collectAssetIds, type AssetId } from './ref.ts';
import type { AssetStore } from './store.ts';

export interface CloudSyncProgress {
	done: number;
	total: number;
	/** The model being sent right now. */
	name: string;
}

export interface CloudSyncResult {
	uploaded: AssetId[];
	/** Already in the cloud (nothing was sent). */
	existing: AssetId[];
	/** Not on this device, so nothing could be sent; the server decides whether the cloud already has them. */
	notLocal: AssetId[];
}

/**
 * Makes sure the cloud has every model a scene uses that this device has,
 * before the scene itself is saved or published there. Idempotent by hash:
 * models the cloud already stores cost nothing, so it is safe to call on every save.
 */
export async function ensureCloudAssets(
	scene: readonly unknown[],
	store: AssetStore,
	options: { onProgress?: (progress: CloudSyncProgress) => void } = {}
): Promise<CloudSyncResult> {
	const ids = [...collectAssetIds(scene)];
	const result: CloudSyncResult = { uploaded: [], existing: [], notLocal: [] };
	let done = 0;
	for (const id of ids) {
		const manifest = await store.getManifest(id);
		options.onProgress?.({ done, total: ids.length, name: manifest?.name ?? 'Model' });
		const bytes = manifest ? await store.getBytes(id) : undefined;
		if (!manifest || !bytes) {
			result.notLocal.push(id);
		} else {
			(await cloudAssets.upload(manifest, bytes)) === 'uploaded' ? result.uploaded.push(id) : result.existing.push(id);
		}
		done++;
	}
	options.onProgress?.({ done, total: ids.length, name: '' });
	return result;
}
