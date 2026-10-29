import type { SlotTree } from '../ecs/types.ts';
import type { AssetId } from '../assets/ref.ts';
import type { InventoryVisibility } from './visibility.ts';

export interface InventoryFolder {
	id: string;
	name: string;
	parentId: string | null;
	/** Cloud only. Absent means private. A public folder makes everything inside it public. */
	visibility?: InventoryVisibility;
}

/** `avatar` items are objects that can be worn: a skinned model with an `avatar` component. */
export type InventoryKind = 'object' | 'world' | 'avatar';

export interface InventoryItem {
	id: string;
	folderId: string | null;
	name: string;
	slotData: SlotTree;
	kind?: InventoryKind;
	worldLineageId?: string | null;
	revisionNumber?: number | null;
	/** The preview image: an `image` asset. Local items keep it in the on-device store only; cloud items also have it in the cloud. */
	thumbnailAssetId?: AssetId | null;
	marketplaceItemId?: string | null;
	/** Cloud only. Absent means private. Public here or on a folder above makes the item readable by anyone with its id. */
	visibility?: InventoryVisibility;
	createdAt: string;
}

export interface InventoryFolderChanges {
	name?: string;
	parentId?: string | null;
	visibility?: InventoryVisibility;
}

export interface InventoryItemChanges {
	name?: string;
	folderId?: string | null;
	visibility?: InventoryVisibility;
}

export interface InventoryContext {
	worldId: string | null;
	userId: string | null;
	/** The signed-in account is an administrator; adapters may show development content to them. */
	isAdmin?: boolean;
	/** The published world being hosted by this player; null otherwise (a guest, a draft). Only then does world storage exist. */
	publicationId?: string | null;
}

/** How much of an adapter's capacity is in use, for the usage bar. `total` 0 means unlimited. */
export interface InventoryUsage {
	used: number;
	total: number;
	unit: 'bytes' | 'count';
}

export type InventoryAdapterId = 'local' | 'world' | 'cloud' | 'purchased' | 'builtin' | 'filesystem' | 'worldStorage';
/** The adapters a world can be saved in: not the read-only ones, and not world storage, which holds objects only. */
export type InventoryStorageAdapterId = Exclude<InventoryAdapterId, 'purchased' | 'builtin' | 'worldStorage'>;

export interface InventoryAdapter {
	readonly id: InventoryAdapterId;
	readonly label: string;
	isAvailable(ctx: InventoryContext): boolean;
	/** Optional user-initiated connection, such as choosing a local directory. */
	connect?(reselect?: boolean): Promise<void>;
	listFolders(ctx: InventoryContext, parentId: string | null): Promise<InventoryFolder[]>;
	createFolder?(ctx: InventoryContext, parentId: string | null, name: string): Promise<InventoryFolder>;
	deleteFolder?(ctx: InventoryContext, folderId: string): Promise<void>;
	/** Renames a folder and/or moves it under another one (`parentId` null is the root). Left-out fields stay as they are. */
	updateFolder?(ctx: InventoryContext, folderId: string, changes: InventoryFolderChanges): Promise<InventoryFolder>;
	listItems(ctx: InventoryContext, folderId: string | null): Promise<InventoryItem[]>;
	saveItem?(ctx: InventoryContext, folderId: string | null, name: string, slotData: SlotTree, kind?: InventoryKind, worldLineageId?: string, thumbnailAssetId?: AssetId | null): Promise<InventoryItem>;
	/** `thumbnailAssetId` left out keeps the item's current preview; `null` removes it. */
	updateItem?(ctx: InventoryContext, itemId: string, folderId: string | null, name: string, slotData: SlotTree, thumbnailAssetId?: AssetId | null): Promise<InventoryItem>;
	/** Renames an item and/or moves it to another folder without touching its contents, so it also works on world revisions. */
	updateItemInfo?(ctx: InventoryContext, itemId: string, changes: InventoryItemChanges): Promise<InventoryItem>;
	setMarketplaceItemId?(ctx: InventoryContext, itemId: string, marketplaceItemId: string): Promise<void>;
	deleteItem?(ctx: InventoryContext, itemId: string): Promise<void>;
	/** Optional: report storage use (e.g. cloud quota). */
	usage?(ctx: InventoryContext): Promise<InventoryUsage | null>;
}
