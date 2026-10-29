import type { WorldItem, WorldItemBackend, WorldItemInput, WorldItemRef } from './items.ts';

const DB_NAME = 'webxr-platform-world-items';
const STORE = 'items';

interface Row extends WorldItem {
	publicationId: string;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB is not available in this browser/context'));
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
			store.createIndex('publicationId', 'publicationId');
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
		request.onblocked = () => reject(new Error('indexedDB.open blocked by another tab'));
	});
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const request = fn(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} finally {
		db.close();
	}
}

const plain = ({ publicationId: _publicationId, ...item }: Row): WorldItem => item;

/**
 * Objects kept on this device (IndexedDB), next to the models they use in the device's asset store. Nothing leaves the device and it
 * costs no cloud space, but it is lost if the browser's data is cleared and is not there on another device.
 */
export const localWorldItems: WorldItemBackend = {
	location: 'local',
	available: () => typeof indexedDB !== 'undefined',
	async list(publicationId) {
		const rows = await run<Row[]>('readonly', (store) => store.index('publicationId').getAll(publicationId));
		return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(plain);
	},
	async find(publicationId, ref: WorldItemRef) {
		const rows = await run<Row[]>('readonly', (store) => store.index('publicationId').getAll(publicationId));
		const found = rows.find((row) => (ref.id ? row.id === ref.id : row.key === ref.key));
		return found ? plain(found) : null;
	},
	async save(publicationId, input: WorldItemInput) {
		const previous = input.id ? await run<Row | undefined>('readonly', (store) => store.get(input.id!)) : undefined;
		const row: Row = {
			id: input.id ?? crypto.randomUUID(),
			publicationId,
			key: input.key ?? previous?.key ?? null,
			name: input.name,
			slotData: input.slotData,
			thumbnailAssetId: input.thumbnailAssetId ?? previous?.thumbnailAssetId ?? null,
			createdAt: previous?.createdAt ?? new Date().toISOString()
		};
		await run('readwrite', (store) => store.put(row));
		return plain(row);
	},
	async remove(_publicationId, id) {
		await run('readwrite', (store) => store.delete(id));
	}
};
