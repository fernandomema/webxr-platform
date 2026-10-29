/**
 * Who may read an inventory item without owning it. `private` is the default; `public` lets anyone who knows the item's id read it
 * (it is never listed). Folders carry it too: a public folder makes everything inside it, at any depth, public.
 */
export const INVENTORY_VISIBILITIES = ['private', 'public'] as const;
export type InventoryVisibility = (typeof INVENTORY_VISIBILITIES)[number];

export function isInventoryVisibility(value: unknown): value is InventoryVisibility {
	return typeof value === 'string' && (INVENTORY_VISIBILITIES as readonly string[]).includes(value);
}

interface FolderNode {
	parentId: string | null;
	visibility?: string;
}

/** Deeper than any real tree; a folder loop (which the services refuse to create) ends here instead of hanging. */
export const MAX_FOLDER_DEPTH = 64;

/** The folders from `folderId` up to the root, nearest first. Stops at a folder it does not know. */
export function folderChain(folderId: string | null, folders: ReadonlyMap<string, FolderNode>): FolderNode[] {
	const chain: FolderNode[] = [];
	const seen = new Set<string>();
	for (let at = folderId; at && !seen.has(at) && chain.length < MAX_FOLDER_DEPTH; ) {
		const folder = folders.get(at);
		if (!folder) break;
		seen.add(at);
		chain.push(folder);
		at = folder.parentId;
	}
	return chain;
}

/** Whether an item can be read by anyone: it is public itself, or a folder above it is. */
export function isPubliclyReadable(item: { visibility?: string }, chain: ReadonlyArray<{ visibility?: string }>): boolean {
	return item.visibility === 'public' || chain.some((folder) => folder.visibility === 'public');
}
