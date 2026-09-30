import { migrateItems } from '../migrate';
import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';
import type { AssetId } from '$lib/assets/ref';
import { ensureCloudAssets } from '$lib/assets/cloudSync';
import { getLocalAssetStore } from '$lib/assets/store';

/** The preview is the only thing this inventory sends to the cloud (models travel peer to peer); if it cannot be sent the item is saved without it. */
async function sendPreview(userId: string | null, id: AssetId | null | undefined): Promise<AssetId | null | undefined> {
	if (!id || !userId) return id ? undefined : id;
	try {
		await ensureCloudAssets([], getLocalAssetStore(), { extraIds: [id] });
		return id;
	} catch {
		return undefined;
	}
}

/** Backed by /api/worlds/[id]/inventory — only meaningful while inside a hosted/joined world. */
export const worldInventoryAdapter: InventoryAdapter = {
	id: 'world',
	label: 'This World',

	isAvailable(ctx) {
		return ctx.worldId !== null;
	},

	async listFolders(ctx, parentId) {
		if (!ctx.worldId) return [];
		const qs = parentId ? `?parentId=${parentId}` : '';
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory/folders${qs}`);
		if (!res.ok) return [];
		return (await res.json()) as InventoryFolder[];
	},

	async createFolder(ctx, parentId, name) {
		if (!ctx.worldId) throw new Error('No active world');
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory/folders`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ parentId, name })
		});
		if (!res.ok) throw new Error(`Failed to create folder (${res.status})`);
		return (await res.json()) as InventoryFolder;
	},

	async deleteFolder(ctx, folderId) {
		if (!ctx.worldId) return;
		await fetch(`/api/worlds/${ctx.worldId}/inventory/folders/${folderId}`, { method: 'DELETE' });
	},

	async listItems(ctx, folderId) {
		if (!ctx.worldId) return [];
		const qs = folderId ? `?folderId=${folderId}` : '';
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory${qs}`);
		if (!res.ok) return [];
		return migrateItems((await res.json()) as InventoryItem[]);
	},

	async saveItem(ctx, folderId, name, slotData, kind = 'object', worldLineageId, thumbnailAssetId) {
		if (!ctx.worldId) throw new Error('No active world to save into');
		const preview = await sendPreview(ctx.userId, thumbnailAssetId);
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData, kind, worldLineageId, thumbnailAssetId: preview })
		});
		if (!res.ok) throw new Error(`Failed to save world item (${res.status})`);
		return (await res.json()) as InventoryItem;
	},

	async updateItem(ctx, itemId, folderId, name, slotData, thumbnailAssetId) {
		if (!ctx.worldId) throw new Error('No active world to update');
		const preview = await sendPreview(ctx.userId, thumbnailAssetId);
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory/${itemId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData, thumbnailAssetId: preview })
		});
		if (!res.ok) throw new Error(`Failed to update world item (${res.status})`);
		return (await res.json()) as InventoryItem;
	},

	async deleteItem(ctx, itemId) {
		if (!ctx.worldId) return;
		await fetch(`/api/worlds/${ctx.worldId}/inventory/${itemId}`, { method: 'DELETE' });
	}
};
