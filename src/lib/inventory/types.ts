import type { SlotTree } from '$lib/ecs/types';
import type { AssetId } from '$lib/assets/ref';

export interface InventoryFolder {
	id: string;
	name: string;
	parentId: string | null;
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
	createdAt: string;
}

export interface InventoryContext {
	worldId: string | null;
	userId: string | null;
}

/** How much of an adapter's capacity is in use, for the usage bar. `total` 0 means unlimited. */
export interface InventoryUsage {
	used: number;
	total: number;
	unit: 'bytes' | 'count';
}

export type InventoryAdapterId = 'local' | 'world' | 'cloud' | 'purchased' | 'filesystem';
export type InventoryStorageAdapterId = Exclude<InventoryAdapterId, 'purchased'>;

export interface InventoryAdapter {
	readonly id: InventoryAdapterId;
	readonly label: string;
	isAvailable(ctx: InventoryContext): boolean;
	/** Optional user-initiated connection, such as choosing a local directory. */
	connect?(reselect?: boolean): Promise<void>;
	listFolders(ctx: InventoryContext, parentId: string | null): Promise<InventoryFolder[]>;
	createFolder?(ctx: InventoryContext, parentId: string | null, name: string): Promise<InventoryFolder>;
	deleteFolder?(ctx: InventoryContext, folderId: string): Promise<void>;
	listItems(ctx: InventoryContext, folderId: string | null): Promise<InventoryItem[]>;
	saveItem?(ctx: InventoryContext, folderId: string | null, name: string, slotData: SlotTree, kind?: InventoryKind, worldLineageId?: string, thumbnailAssetId?: AssetId | null): Promise<InventoryItem>;
	/** `thumbnailAssetId` left out keeps the item's current preview; `null` removes it. */
	updateItem?(ctx: InventoryContext, itemId: string, folderId: string | null, name: string, slotData: SlotTree, thumbnailAssetId?: AssetId | null): Promise<InventoryItem>;
	setMarketplaceItemId?(ctx: InventoryContext, itemId: string, marketplaceItemId: string): Promise<void>;
	deleteItem?(ctx: InventoryContext, itemId: string): Promise<void>;
	/** Optional: report storage use (e.g. cloud quota). */
	usage?(ctx: InventoryContext): Promise<InventoryUsage | null>;
}
