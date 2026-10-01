import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types';
import { BUILTIN_ENTRIES, BUILTIN_FOLDERS } from '../builtin/catalog';

/** Everything in the starter kit was made at once; the date only gives the items a stable order. */
const CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Read-only inventory of ready-made objects every player has: basics, music and tools to start from. */
export const builtinInventoryAdapter: InventoryAdapter = {
	id: 'builtin',
	label: 'Starter Kit',
	isAvailable: () => true,
	async listFolders(_ctx, parentId): Promise<InventoryFolder[]> {
		return parentId === null ? BUILTIN_FOLDERS.map((folder) => ({ ...folder, parentId: null })) : [];
	},
	async listItems(_ctx, folderId): Promise<InventoryItem[]> {
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
