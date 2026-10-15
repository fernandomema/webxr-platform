import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';
import { BUILTIN_ENTRIES, BUILTIN_FOLDERS } from '../builtin/catalog.ts';

/** Everything in the starter kit was made at once; the date only gives the items a stable order. */
const CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Only a dev server has the Development folder; `env` is absent when this runs outside Vite (the tests). */
const isDev = (): boolean => Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

const DEV_FOLDERS: InventoryFolder[] = [
	{ id: 'dev', name: 'Dev', parentId: null },
	{ id: 'dev-worlds', name: 'Worlds', parentId: 'dev' }
];

/** Read-only inventory of ready-made objects every player has: basics, music and tools to start from. */
export const builtinInventoryAdapter: InventoryAdapter = {
	id: 'builtin',
	label: 'Starter Kit',
	isAvailable: () => true,
	async listFolders(_ctx, parentId): Promise<InventoryFolder[]> {
		const folders = BUILTIN_FOLDERS.filter((folder) => (folder.parentId ?? null) === parentId).map((folder) => ({ ...folder, parentId: folder.parentId ?? null }));
		return isDev() ? [...folders, ...DEV_FOLDERS.filter((folder) => folder.parentId === parentId)] : folders;
	},
	async listItems(_ctx, folderId): Promise<InventoryItem[]> {
		if (isDev() && folderId === 'dev-worlds') {
			// Imported here so a release never loads the worlds' builders through the Starter Kit.
			const { BUILTIN_WORLDS } = await import('../../xr/templates/builtinWorlds');
			return BUILTIN_WORLDS.map((world) => ({
				id: `builtin:world:${world.id}`,
				folderId,
				name: world.name,
				slotData: JSON.parse(JSON.stringify(world.scene)),
				kind: 'world',
				createdAt: CREATED_AT
			}));
		}
		return BUILTIN_ENTRIES.filter((entry) => entry.folderId === folderId).map((entry) => ({
			id: `builtin:${entry.id}`,
			folderId: entry.folderId,
			name: entry.name,
			slotData: entry.build(),
			kind: 'object',
			createdAt: CREATED_AT
		}));
	}
};
