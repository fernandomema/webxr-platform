import { migrateItems } from '../migrate';
import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';
import type { AssetId } from '$lib/assets/ref';
import { getLocalAssetStore } from '$lib/assets/store';

const DB_NAME = 'webxr-platform-inventory';
const DB_VERSION = 2;
const ITEMS_STORE = 'items';
const FOLDERS_STORE = 'folders';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('indexedDB is not available in this browser/context'));
			return;
		}
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(ITEMS_STORE)) db.createObjectStore(ITEMS_STORE, { keyPath: 'id' });
			if (!db.objectStoreNames.contains(FOLDERS_STORE)) db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
		req.onblocked = () => reject(new Error('indexedDB.open blocked (another tab has an older version open?)'));
	});
}

async function withStore<T>(
	storeName: string,
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeName, mode);
		const request = fn(tx.objectStore(storeName));
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Always available, no login required — persists per-device via IndexedDB.
 * (Not the File System Access API: that needs a native OS picker dialog,
 * which isn't usable inside an active `immersive-vr` session and isn't
 * supported by every browser. IndexedDB works everywhere, including in XR.)
 */
/**
 * A preview lives in the on-device asset store and nowhere else. When the item that had it is replaced or deleted it goes too,
 * unless another item shows the same image. Failing to tidy up is harmless (a few kilobytes), so it never fails the operation.
 */
async function dropPreviewIfUnused(assetId: AssetId | null | undefined, remaining: InventoryItem[]): Promise<void> {
	if (!assetId || remaining.some((item) => item.thumbnailAssetId === assetId)) return;
	try {
		await getLocalAssetStore().delete(assetId);
	} catch {
		// leave it for the next time
	}
}

export const localInventoryAdapter: InventoryAdapter = {
	id: 'local',
	label: 'Local',

	isAvailable() {
		return typeof indexedDB !== 'undefined';
	},

	async listFolders(_ctx, parentId) {
		const all = await withStore<InventoryFolder[]>(FOLDERS_STORE, 'readonly', (store) => store.getAll());
		return all.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
	},

	async createFolder(_ctx, parentId, name) {
		const folder: InventoryFolder = { id: crypto.randomUUID(), name, parentId };
		await withStore(FOLDERS_STORE, 'readwrite', (store) => store.put(folder));
		return folder;
	},

	async deleteFolder(ctx, folderId) {
		// move any subfolders/items back to root, matching the server adapters' onDelete:SetNull behaviour
		const [folders, items] = await Promise.all([this.listFolders(ctx, folderId), this.listItems(ctx, folderId)]);
		for (const f of folders) await withStore(FOLDERS_STORE, 'readwrite', (store) => store.put({ ...f, parentId: null }));
		for (const it of items) await withStore(ITEMS_STORE, 'readwrite', (store) => store.put({ ...it, folderId: null }));
		await withStore(FOLDERS_STORE, 'readwrite', (store) => store.delete(folderId));
	},

	async listItems(_ctx, folderId) {
		const items = await withStore<InventoryItem[]>(ITEMS_STORE, 'readonly', (store) => store.getAll());
		return migrateItems(items.filter((i) => i.folderId === folderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
	},

	async saveItem(_ctx, folderId, name, slotData, kind = 'object', lineageId, thumbnailAssetId) {
		const worldLineageId = kind === 'world' ? lineageId ?? crypto.randomUUID() : null;
		const existing = kind === 'world' ? await withStore<InventoryItem[]>(ITEMS_STORE, 'readonly', (store) => store.getAll()) : [];
		const revisionNumber = kind === 'world' ? 1 + Math.max(0, ...existing.filter((item) => item.worldLineageId === worldLineageId).map((item) => item.revisionNumber ?? 0)) : null;
		const item: InventoryItem = {
			id: crypto.randomUUID(),
			folderId,
			name,
			slotData,
			kind,
			worldLineageId,
			revisionNumber,
			...(thumbnailAssetId ? { thumbnailAssetId } : {}),
			createdAt: new Date().toISOString()
		};
		await withStore(ITEMS_STORE, 'readwrite', (store) => store.put(item));
		return item;
	},

	async updateItem(_ctx, itemId, folderId, name, slotData, thumbnailAssetId) {
		const items = await withStore<InventoryItem[]>(ITEMS_STORE, 'readonly', (store) => store.getAll());
		const existing = items.find((item) => item.id === itemId);
		if (!existing) throw new Error('Inventory item not found');
		if (existing.kind === 'world') throw new Error('World revisions are immutable; save a new revision instead');
		const updated: InventoryItem = { ...existing, folderId, name, slotData, ...(thumbnailAssetId === undefined ? {} : { thumbnailAssetId }) };
		await withStore(ITEMS_STORE, 'readwrite', (store) => store.put(updated));
		if (existing.thumbnailAssetId !== updated.thumbnailAssetId) await dropPreviewIfUnused(existing.thumbnailAssetId, items.filter((item) => item.id !== itemId));
		return updated;
	},

	async setMarketplaceItemId(_ctx, itemId, marketplaceItemId) {
		const items = await withStore<InventoryItem[]>(ITEMS_STORE, 'readonly', (store) => store.getAll());
		const item = items.find((entry) => entry.id === itemId);
		if (!item) throw new Error('Inventory item not found');
		await withStore(ITEMS_STORE, 'readwrite', (store) => store.put({ ...item, marketplaceItemId }));
	},

	async deleteItem(_ctx, itemId) {
		const items = await withStore<InventoryItem[]>(ITEMS_STORE, 'readonly', (store) => store.getAll());
		await withStore(ITEMS_STORE, 'readwrite', (store) => store.delete(itemId));
		await dropPreviewIfUnused(items.find((item) => item.id === itemId)?.thumbnailAssetId, items.filter((item) => item.id !== itemId));
	}
};
