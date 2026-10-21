import { CloudResolver } from './cloud.ts';
import type { AssetId } from './ref.ts';
import { resolveAsset, type AssetResolver } from './resolve.ts';
import { getLocalAssetStore } from './store.ts';

/**
 * Turns the preview of an inventory item into something a page or a headset panel can show: an object URL for its image.
 * The on-device store is always tried first, so previews of local items are shown with no account and no network; the cloud (and
 * peers, in the game) are asked only for a preview this device does not have, such as a cloud item opened on another device.
 */

const MAX_CACHED = 300;

let sources: () => AssetResolver[] = () => [new CloudResolver()];
const urls = new Map<AssetId, string>();
const pending = new Map<AssetId, Promise<string | null>>();

/** Where to look for previews this device does not have. The game adds peers to the cloud. */
export function configureThumbnailSources(next: () => AssetResolver[]): void {
	sources = next;
}

/** An object URL for the preview image, or null if it cannot be found. Cached: the same asset is only read once. */
export function thumbnailUrl(assetId: AssetId): Promise<string | null> {
	const known = urls.get(assetId);
	if (known) return Promise.resolve(known);
	let job = pending.get(assetId);
	if (!job) {
		job = (async () => {
			try {
				const store = getLocalAssetStore();
				const result = await resolveAsset(assetId, sources(), store);
				if (!result.ok) return null;
				const manifest = await store.getManifest(assetId);
				const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: manifest?.mimeType ?? 'image/webp' }));
				urls.set(assetId, url);
				if (urls.size > MAX_CACHED) {
					const [oldest] = urls.keys();
					URL.revokeObjectURL(urls.get(oldest)!);
					urls.delete(oldest);
				}
				return url;
			} catch {
				return null;
			} finally {
				pending.delete(assetId); // a miss is tried again next time; a hit is in `urls`
			}
		})();
		pending.set(assetId, job);
	}
	return job;
}
