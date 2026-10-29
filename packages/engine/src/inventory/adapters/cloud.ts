import { platformFetch } from '../../xr/platform/config.ts';
import { migrateItems } from '../migrate.ts';
import { CloudAssetError } from '../../assets/cloud.ts';
import { ensureCloudAssets } from '../../assets/cloudSync.ts';
import { getLocalAssetStore } from '../../assets/store.ts';
import type { AssetId } from '../../assets/ref.ts';

const previewIds = (id: AssetId | null | undefined): AssetId[] => (id ? [id] : []);

async function saveFailure(response: Response, fallback: string): Promise<Error> {
	let body: { message?: string; missing?: string[] } = {};
	try {
		body = await response.json();
	} catch {
		// Not JSON.
	}
	return new CloudAssetError(body.message ?? `${fallback} (${response.status})`, response.status, body.missing);
}
import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types.ts';

/** Backed by /api/inventory — the logged-in user's personal inventory, travels between worlds. */
export const cloudInventoryAdapter: InventoryAdapter = {
	id: 'cloud',
	label: 'Cloud',

	isAvailable(ctx) {
		return ctx.userId !== null;
	},

	async listFolders(_ctx, parentId) {
		const qs = parentId ? `?parentId=${parentId}` : '';
		const res = await platformFetch(`/api/inventory/folders${qs}`);
		if (!res.ok) return [];
		return (await res.json()) as InventoryFolder[];
	},

	async createFolder(_ctx, parentId, name) {
		const res = await platformFetch('/api/inventory/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ parentId, name })
		});
		if (!res.ok) throw new Error(`Failed to create folder (${res.status})`);
		return (await res.json()) as InventoryFolder;
	},

	async updateFolder(_ctx, folderId, changes) {
		const res = await platformFetch(`/api/inventory/folders/${folderId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(changes)
		});
		if (!res.ok) throw new Error(`Failed to update folder (${res.status})`);
		return (await res.json()) as InventoryFolder;
	},

	async deleteFolder(_ctx, folderId) {
		await platformFetch(`/api/inventory/folders/${folderId}`, { method: 'DELETE' });
	},

	async listItems(_ctx, folderId) {
		const qs = folderId ? `?folderId=${folderId}` : '';
		const res = await platformFetch(`/api/inventory${qs}`);
		if (!res.ok) return [];
		return migrateItems((await res.json()) as InventoryItem[]);
	},

	async saveItem(_ctx, folderId, name, slotData, kind = 'object', worldLineageId, thumbnailAssetId) {
		// Models are stored once, by hash: send the ones the cloud does not have yet, then the scene that uses them, and its preview.
		await ensureCloudAssets(slotData, getLocalAssetStore(), { extraIds: previewIds(thumbnailAssetId) });
		const res = await platformFetch('/api/inventory', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData, kind, worldLineageId, thumbnailAssetId })
		});
		if (!res.ok) throw await saveFailure(res, 'Failed to save cloud item');
		return (await res.json()) as InventoryItem;
	},

	async updateItem(_ctx, itemId, folderId, name, slotData, thumbnailAssetId) {
		await ensureCloudAssets(slotData, getLocalAssetStore(), { extraIds: previewIds(thumbnailAssetId) });
		const res = await platformFetch(`/api/inventory/${itemId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData, thumbnailAssetId })
		});
		if (!res.ok) throw await saveFailure(res, 'Failed to update cloud item');
		return (await res.json()) as InventoryItem;
	},

	async updateItemInfo(_ctx, itemId, changes) {
		const res = await platformFetch(`/api/inventory/${itemId}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(changes)
		});
		if (!res.ok) throw new Error(`Failed to update cloud item (${res.status})`);
		return (await res.json()) as InventoryItem;
	},

	async deleteItem(_ctx, itemId) {
		await platformFetch(`/api/inventory/${itemId}`, { method: 'DELETE' });
	},

	async usage() {
		const res = await platformFetch('/api/assets/usage');
		if (!res.ok) return null;
		const { bytes, quota } = (await res.json()) as { bytes: number; quota: number };
		return { used: bytes, total: quota, unit: 'bytes' };
	}
};
