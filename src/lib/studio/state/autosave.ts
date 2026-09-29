import type { SlotTree } from '$lib/ecs/types';

export interface Draft {
	key: string;
	name: string;
	kind: 'object' | 'world';
	tree: SlotTree;
	savedAt: number;
}

const DB_NAME = 'studio-drafts';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
	try {
		const db = await open();
		return await new Promise<T>((resolve, reject) => {
			const request = action(db.transaction(STORE, mode).objectStore(STORE));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	} catch {
		// Drafts are a convenience; a blocked IndexedDB must never break editing.
		return undefined;
	}
}

export const loadDraft = (key: string) => run<Draft | undefined>('readonly', (store) => store.get(key));
export const saveDraft = (draft: Draft) => run('readwrite', (store) => store.put(draft));
export const deleteDraft = (key: string) => run('readwrite', (store) => store.delete(key));
