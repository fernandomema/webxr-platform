import { platformFetch } from '../xr/platform/config.ts';
import { CloudAssetError } from '../assets/cloud.ts';
import { ensureCloudAssets } from '../assets/cloudSync.ts';
import { getLocalAssetStore } from '../assets/store.ts';
import { migrateSlotTree } from '../assets/ref.ts';
import { WorldItemError, type WorldItem, type WorldItemBackend, type WorldItemInput, type WorldItemRef } from './items.ts';

const base = (publicationId: string) => `/api/published-worlds/${encodeURIComponent(publicationId)}/items`;

async function fail(response: Response, fallback: string): Promise<Error> {
	let body: { message?: string; missing?: string[] } = {};
	try {
		body = await response.json();
	} catch {
		// Not JSON.
	}
	const message = body.message ?? `${fallback} (${response.status})`;
	if (response.status === 413) return new WorldItemError('quota', message);
	if (response.status === 409 && body.missing) return new CloudAssetError(message, response.status, body.missing);
	return new WorldItemError(response.status === 404 ? 'not-found' : 'unavailable', message);
}

const read = (item: WorldItem): WorldItem => ({ ...item, slotData: migrateSlotTree(item.slotData) });

/**
 * Objects kept in the cloud, for the signed-in host. They count in the host's storage (the objects' own data and the models they use),
 * not in the world's creator's, and are there from any device.
 */
export function cloudWorldItems(isSignedIn: () => boolean): WorldItemBackend {
	return {
		location: 'cloud',
		available: isSignedIn,
		async list(publicationId) {
			const response = await platformFetch(base(publicationId));
			if (!response.ok) throw await fail(response, 'Could not list saved objects');
			return ((await response.json()) as WorldItem[]).map(read);
		},
		async find(publicationId, ref: WorldItemRef) {
			const response = await platformFetch(ref.id ? `${base(publicationId)}/${encodeURIComponent(ref.id)}` : `${base(publicationId)}?key=${encodeURIComponent(ref.key ?? '')}`);
			if (response.status === 404) return null;
			if (!response.ok) throw await fail(response, 'Could not read the saved object');
			const body = (await response.json()) as WorldItem | WorldItem[];
			const item = Array.isArray(body) ? body[0] : body;
			return item ? read(item) : null;
		},
		async save(publicationId, input: WorldItemInput) {
			// Models are stored once, by hash: send the ones the cloud does not have yet, then the object that uses them.
			await ensureCloudAssets(input.slotData, getLocalAssetStore(), { extraIds: input.thumbnailAssetId ? [input.thumbnailAssetId] : [] });
			const response = await platformFetch(input.id ? `${base(publicationId)}/${encodeURIComponent(input.id)}` : base(publicationId), {
				method: input.id ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ key: input.key ?? null, name: input.name, slotData: input.slotData, thumbnailAssetId: input.thumbnailAssetId })
			});
			if (!response.ok) throw await fail(response, 'Could not save the object');
			return read((await response.json()) as WorldItem);
		},
		async remove(publicationId, id) {
			const response = await platformFetch(`${base(publicationId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
			if (!response.ok && response.status !== 404) throw await fail(response, 'Could not delete the object');
		}
	};
}
