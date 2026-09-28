import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';

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
		return (await res.json()) as InventoryItem[];
	},

	async saveItem(ctx, folderId, name, slotData) {
		if (!ctx.worldId) throw new Error('No active world to save into');
		const res = await fetch(`/api/worlds/${ctx.worldId}/inventory`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData })
		});
		if (!res.ok) throw new Error(`Failed to save world item (${res.status})`);
		return (await res.json()) as InventoryItem;
	},

	async deleteItem(ctx, itemId) {
		if (!ctx.worldId) return;
		await fetch(`/api/worlds/${ctx.worldId}/inventory/${itemId}`, { method: 'DELETE' });
	}
};
