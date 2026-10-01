import { isAssetId, migrateSlotTree } from '$lib/assets/ref';
import { validateWorldScene } from '$lib/worlds/package';
import type { InventoryAdapter, InventoryFolder, InventoryItem, InventoryKind } from '../types';

/** A developer-selected directory. Browsers only expose it after a user gesture. */
type BrowsableDirectory = FileSystemDirectoryHandle & {
	values(): AsyncIterableIterator<FileSystemHandle>;
	queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
	requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

const DB_NAME = 'webxr-platform-filesystem-inventory';
const STORE_NAME = 'handles';
const ROOT_KEY = 'project-folder';
let root: BrowsableDirectory | null = null;
let restoring: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function restoreRoot(): Promise<void> {
	if (root) return;
	restoring ??= (async () => {
		const db = await openDb();
		try {
			const saved = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
				const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ROOT_KEY);
				request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
				request.onerror = () => reject(request.error);
			});
			if (!root) root = (saved as BrowsableDirectory | undefined) ?? null;
		} finally { db.close(); }
	})().catch(() => { /* The picker remains available when storage is blocked. */ });
	await restoring;
}

async function persistRoot(handle: BrowsableDirectory): Promise<void> {
	const db = await openDb();
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite');
			tx.objectStore(STORE_NAME).put(handle, ROOT_KEY);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
	} finally { db.close(); }
}

function assertDevelopment(): void {
	if (!import.meta.env.DEV) throw new Error('The filesystem inventory is only available in development.');
}

function directoryPicker(): ((options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>) | undefined {
	if (typeof window === 'undefined') return undefined;
	return (window as Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker?.bind(window);
}

function pathParts(id: string | null): string[] {
	return id ? id.split('/').map(decodeURIComponent) : [];
}

function childId(parentId: string | null, name: string): string {
	return [...(parentId ? parentId.split('/') : []), encodeURIComponent(name)].join('/');
}

async function directory(id: string | null): Promise<BrowsableDirectory> {
	await restoreRoot();
	let handle = root;
	if (!handle) throw new Error('Choose a project folder before using this inventory.');
	if (await handle.queryPermission({ mode: 'read' }) !== 'granted') {
		throw new Error('Reconnect the project folder to grant browser access.');
	}
	for (const name of pathParts(id)) handle = await handle.getDirectoryHandle(name) as BrowsableDirectory;
	return handle;
}

function fileName(itemId: string): string {
	const name = pathParts(itemId).at(-1);
	if (!name || !name.toLowerCase().endsWith('.json')) throw new Error('Invalid inventory item');
	return name;
}

function newFileName(name: string): string {
	const stem = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60) || 'item';
	return `${stem}-${crypto.randomUUID()}.json`;
}

function itemFromJson(value: unknown, file: File, folderId: string | null): InventoryItem | null {
	const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
	const scene = Array.isArray(value) ? value : record?.slotData ?? record?.scene;
	if (!Array.isArray(scene)) return null;
	validateWorldScene(scene);
	const kind: InventoryKind = record?.kind === 'world' || record?.kind === 'avatar' || record?.kind === 'object'
		? record.kind : record?.scene ? 'world' : 'object';
	const id = childId(folderId, file.name);
	return {
		id,
		folderId,
		name: typeof record?.name === 'string' && record.name.trim() ? record.name : file.name.replace(/\.json$/i, ''),
		slotData: migrateSlotTree(scene),
		kind,
		createdAt: typeof record?.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt))
			? record.createdAt : new Date(file.lastModified).toISOString(),
		...(kind === 'world' ? {
			worldLineageId: typeof record?.worldLineageId === 'string' ? record.worldLineageId : id,
			revisionNumber: typeof record?.revisionNumber === 'number' ? record.revisionNumber : 1
		} : {}),
		...(isAssetId(record?.thumbnailAssetId) ? { thumbnailAssetId: record.thumbnailAssetId } : {}),
		...(typeof record?.marketplaceItemId === 'string' ? { marketplaceItemId: record.marketplaceItemId } : {})
	};
}

async function readItem(itemId: string): Promise<InventoryItem> {
	const parts = pathParts(itemId);
	const folderId = parts.length > 1 ? parts.slice(0, -1).map(encodeURIComponent).join('/') : null;
	const file = await (await directory(folderId)).getFileHandle(fileName(itemId)).then((handle) => handle.getFile());
	const item = itemFromJson(JSON.parse(await file.text()), file, folderId);
	if (!item) throw new Error('Invalid inventory item');
	return item;
}

async function writeItem(item: InventoryItem): Promise<void> {
	const handle = await (await directory(item.folderId)).getFileHandle(fileName(item.id), { create: true });
	const writer = await handle.createWritable();
	try { await writer.write(JSON.stringify(item, null, 2) + '\n'); await writer.close(); }
	catch (error) { await writer.abort(); throw error; }
}

/** JSON inventory rooted at a directory chosen in a development browser. */
export const filesystemInventoryAdapter: InventoryAdapter = {
	id: 'filesystem',
	label: 'Project files',

	isAvailable() {
		return import.meta.env.DEV && Boolean(directoryPicker());
	},

	async connect(reselect = false) {
		assertDevelopment();
		if (root && !reselect) {
			if (await root.requestPermission({ mode: 'readwrite' }) === 'granted') return;
		}
		const pick = directoryPicker();
		if (!pick) throw new Error('The File System Access API is not available in this browser.');
		const picked = await pick({ mode: 'readwrite' }) as BrowsableDirectory;
		await persistRoot(picked);
		root = picked;
	},

	async listFolders(_ctx, parentId) {
		assertDevelopment();
		await restoreRoot();
		if (!root) return [];
		const folders: InventoryFolder[] = [];
		for await (const entry of (await directory(parentId)).values()) {
			if (entry.kind === 'directory') folders.push({ id: childId(parentId, entry.name), name: entry.name, parentId });
		}
		return folders.sort((a, b) => a.name.localeCompare(b.name));
	},

	async listItems(_ctx, folderId) {
		assertDevelopment();
		await restoreRoot();
		if (!root) return [];
		const items: InventoryItem[] = [];
		for await (const entry of (await directory(folderId)).values()) {
			if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
			const file = await (entry as FileSystemFileHandle).getFile();
			let value: unknown;
			try { value = JSON.parse(await file.text()); }
			catch { continue; }
			try {
				const item = itemFromJson(value, file, folderId);
				if (item) items.push(item);
			} catch (error) {
				throw new Error(`Invalid inventory file ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		return items.sort((a, b) => a.name.localeCompare(b.name));
	},

	async saveItem(ctx, folderId, name, slotData, kind = 'object', lineageId, thumbnailAssetId) {
		assertDevelopment();
		await directory(folderId);
		validateWorldScene(slotData);
		const worldLineageId = kind === 'world' ? lineageId ?? crypto.randomUUID() : null;
		const existing = kind === 'world' ? await this.listItems(ctx, folderId) : [];
		const revisionNumber = kind === 'world'
			? 1 + Math.max(0, ...existing.filter((item) => item.worldLineageId === worldLineageId).map((item) => item.revisionNumber ?? 0))
			: null;
		const item: InventoryItem = {
			id: childId(folderId, newFileName(name)), folderId, name, slotData: migrateSlotTree(slotData), kind,
			worldLineageId, revisionNumber,
			...(thumbnailAssetId ? { thumbnailAssetId } : {}),
			createdAt: new Date().toISOString()
		};
		await writeItem(item);
		return item;
	},

	async updateItem(_ctx, itemId, folderId, name, slotData, thumbnailAssetId) {
		assertDevelopment();
		validateWorldScene(slotData);
		const existing = await readItem(itemId);
		if (existing.kind === 'world') throw new Error('World revisions are immutable; save a new revision instead');
		const id = folderId === existing.folderId ? itemId : childId(folderId, newFileName(name));
		const updated: InventoryItem = {
			...existing, id, folderId, name, slotData: migrateSlotTree(slotData),
			...(thumbnailAssetId === undefined ? {} : { thumbnailAssetId })
		};
		await writeItem(updated);
		if (id !== itemId) await (await directory(existing.folderId)).removeEntry(fileName(itemId));
		return updated;
	},

	async setMarketplaceItemId(_ctx, itemId, marketplaceItemId) {
		assertDevelopment();
		await writeItem({ ...await readItem(itemId), marketplaceItemId });
	},

	async deleteItem(_ctx, itemId) {
		assertDevelopment();
		const item = await readItem(itemId);
		await (await directory(item.folderId)).removeEntry(fileName(itemId));
	}
};
