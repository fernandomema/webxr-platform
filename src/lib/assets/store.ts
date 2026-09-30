import type { AssetManifest } from './manifest';
import type { AssetId } from './ref';

/** Fires `put` whenever new bytes reach any store on this page, so things waiting for a model can look again at once. */
export const assetStoreChanges = new EventTarget();
const announcePut = () => assetStoreChanges.dispatchEvent(new Event('put'));

export type AssetListing = AssetManifest & {
	importedAt: number;
	lastUsedAt: number;
};

/**
 * Where model bytes live on this device: imported files, and everything
 * downloaded from the cloud or a host. Bytes are addressed by hash, so the same
 * model is stored once however many objects and worlds use it.
 */
export interface AssetStore {
	has(id: AssetId): Promise<boolean>;
	getManifest(id: AssetId): Promise<AssetManifest | undefined>;
	getBytes(id: AssetId): Promise<Uint8Array | undefined>;
	/** Idempotent: storing the same id again keeps the existing record. */
	put(manifest: AssetManifest, bytes: Uint8Array): Promise<void>;
	list(): Promise<AssetListing[]>;
	delete(id: AssetId): Promise<void>;
	usage(): Promise<{ count: number; bytes: number }>;
}

/** For tests and non-browser code. */
export class MemoryAssetStore implements AssetStore {
	private records = new Map<AssetId, { listing: AssetListing; bytes: Uint8Array }>();

	async has(id: AssetId) {
		return this.records.has(id);
	}

	async getManifest(id: AssetId) {
		return this.records.get(id)?.listing;
	}

	async getBytes(id: AssetId) {
		const record = this.records.get(id);
		if (record) record.listing.lastUsedAt = Date.now();
		return record?.bytes;
	}

	async put(manifest: AssetManifest, bytes: Uint8Array) {
		if (this.records.has(manifest.assetId)) return;
		const now = Date.now();
		this.records.set(manifest.assetId, { listing: { ...manifest, importedAt: now, lastUsedAt: now }, bytes: bytes.slice() });
		announcePut();
	}

	async list() {
		return [...this.records.values()].map((record) => ({ ...record.listing }));
	}

	async delete(id: AssetId) {
		this.records.delete(id);
	}

	async usage() {
		let bytes = 0;
		for (const { listing } of this.records.values()) bytes += listing.byteSize;
		return { count: this.records.size, bytes };
	}
}

const DB_NAME = 'webxr-platform-assets';
const MANIFESTS = 'manifests';
const BLOBS = 'blobs';

/**
 * A database of its own, separate from the inventory's, so adding it never
 * touches the inventory schema version. Listings and bytes are in separate
 * stores so listing models never loads their bytes.
 */
export class IndexedDbAssetStore implements AssetStore {
	private dbPromise: Promise<IDBDatabase> | null = null;

	private db(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise;
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			if (typeof indexedDB === 'undefined') {
				reject(new Error('indexedDB is not available in this browser/context'));
				return;
			}
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(MANIFESTS)) db.createObjectStore(MANIFESTS, { keyPath: 'assetId' });
				if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'assetId' });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
			request.onblocked = () => reject(new Error('indexedDB.open blocked by another tab'));
		});
		// A failed open is retried on the next call instead of being cached forever.
		opening.catch(() => {
			this.dbPromise = null;
		});
		this.dbPromise = opening;
		return opening;
	}

	/** Resolves when the whole transaction commits, so a write is durable before the caller continues. */
	private async run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
		const db = await this.db();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(stores, mode);
			const request = work(tx);
			tx.oncomplete = () => resolve(request ? (request.result as T) : undefined);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
		});
	}

	async has(id: AssetId) {
		return (await this.getManifest(id)) !== undefined;
	}

	async getManifest(id: AssetId) {
		return this.run<AssetListing | undefined>([MANIFESTS], 'readonly', (tx) => tx.objectStore(MANIFESTS).get(id));
	}

	async getBytes(id: AssetId) {
		const record = await this.run<{ assetId: AssetId; bytes: ArrayBuffer } | undefined>([BLOBS], 'readonly', (tx) => tx.objectStore(BLOBS).get(id));
		if (!record) return undefined;
		void this.touch(id);
		return new Uint8Array(record.bytes);
	}

	private async touch(id: AssetId) {
		try {
			await this.run([MANIFESTS], 'readwrite', (tx) => {
				const store = tx.objectStore(MANIFESTS);
				const request = store.get(id);
				request.onsuccess = () => {
					if (request.result) store.put({ ...request.result, lastUsedAt: Date.now() });
				};
			});
		} catch {
			// Usage tracking is best effort.
		}
	}

	async put(manifest: AssetManifest, bytes: Uint8Array) {
		if (await this.has(manifest.assetId)) return;
		const now = Date.now();
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		await this.run([MANIFESTS, BLOBS], 'readwrite', (tx) => {
			tx.objectStore(BLOBS).put({ assetId: manifest.assetId, bytes: buffer });
			tx.objectStore(MANIFESTS).put({ ...manifest, importedAt: now, lastUsedAt: now } satisfies AssetListing);
		});
		announcePut();
	}

	async list() {
		return (await this.run<AssetListing[]>([MANIFESTS], 'readonly', (tx) => tx.objectStore(MANIFESTS).getAll())) ?? [];
	}

	async delete(id: AssetId) {
		await this.run([MANIFESTS, BLOBS], 'readwrite', (tx) => {
			tx.objectStore(MANIFESTS).delete(id);
			tx.objectStore(BLOBS).delete(id);
		});
	}

	async usage() {
		const listings = await this.list();
		return { count: listings.length, bytes: listings.reduce((sum, item) => sum + item.byteSize, 0) };
	}
}

let shared: AssetStore | null = null;

/** The device-wide store, shared by the Studio and the game (same origin), which is also how Play hands models over. */
export function getLocalAssetStore(): AssetStore {
	shared ??= new IndexedDbAssetStore();
	return shared;
}
