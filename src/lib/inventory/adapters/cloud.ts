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
		return (await res.json()) as InventoryItem[];
	},

	async saveItem(_ctx, folderId, name, slotData) {
		const res = await fetch('/api/inventory', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ folderId, name, slotData })
		});
		if (!res.ok) throw new Error(`Failed to save cloud item (${res.status})`);
		return (await res.json()) as InventoryItem;
	},

	async deleteItem(_ctx, itemId) {
		await fetch(`/api/inventory/${itemId}`, { method: 'DELETE' });
	}
};
