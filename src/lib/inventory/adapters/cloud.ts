import { migrateItems } from '../migrate';
import { CloudAssetError } from '$lib/assets/cloud';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import { getLocalAssetStore } from '$lib/assets/store';

async function saveFailure(response: Response, fallback: string): Promise<Error> {
	let body: { message?: string; missing?: string[] } = {};
	try {
		body = await response.json();
	} catch {
		// Not JSON.
	}
	return new CloudAssetError(body.message ?? `${fallback} (${response.status})`, response.status, body.missing);
}
import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';

/** Backed by /api/inventory — the logged-in user's personal inventory, travels between worlds. */
export const cloudInventoryAdapter: InventoryAdapter = {
	id: 'cloud',
	label: 'Cloud',

	isAvailable(ctx) {
		return ctx.userId !== null;
	},

	async listFolders(_ctx, parentId) {
		const qs = parentId ? `?parentId=${parentId}` : '';
		const res = await fetch(`/api/inventory/folders${qs}`);
		if (!res.ok) return [];
		return (await res.json()) as InventoryFolder[];
	},

	async createFolder(_ctx, parentId, name) {
		const res = await fetch('/api/inventory/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ parentId, name })
		});
		if (!res.ok) throw new Error(`Failed to create folder (${res.status})`);
		return (await res.json()) as InventoryFolder;
	},

	async deleteFolder(_ctx, folderId) {
		await fetch(`/api/inventory/folders/${folderId}`, { method: 'DELETE' });
	},

	async listItems(_ctx, folderId) {
		const qs = folderId ? `?folderId=${folderId}` : '';
		const res = await fetch(`/api/inventory${qs}`);
		if (!res.ok) return [];
		return migrateItems((await res.json()) as InventoryItem[]);
	},

	async saveItem(_ctx, folderId, name, slotData, kind = 'object', worldLineageId) {
		// Models are stored once, by hash: send the ones the cloud does not have yet, then the scene that uses them.
		await ensureCloudAssets(slotData, getLocalAssetStore());
		const res = await fetch('/api/inventory', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData, kind, worldLineageId })
		});
		if (!res.ok) throw await saveFailure(res, 'Failed to save cloud item');
		return (await res.json()) as InventoryItem;
	},

	async updateItem(_ctx, itemId, folderId, name, slotData) {
		await ensureCloudAssets(slotData, getLocalAssetStore());
		const res = await fetch(`/api/inventory/${itemId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData })
		});
		if (!res.ok) throw await saveFailure(res, 'Failed to update cloud item');
		return (await res.json()) as InventoryItem;
	},

	async deleteItem(_ctx, itemId) {
		await fetch(`/api/inventory/${itemId}`, { method: 'DELETE' });
	},

	async usage() {
		const res = await fetch('/api/assets/usage');
		if (!res.ok) return null;
		const { bytes, quota } = (await res.json()) as { bytes: number; quota: number };
		return { used: bytes, total: quota, unit: 'bytes' };
	}
};
