import type { SlotTree } from '$lib/ecs/types';

export interface InventoryFolder {
	id: string;
	name: string;
	parentId: string | null;
}

export interface InventoryItem {
	id: string;
	folderId: string | null;
	name: string;
	slotData: SlotTree;
	kind?: 'object' | 'world';
	worldLineageId?: string | null;
	revisionNumber?: number | null;
	thumbnailUrl?: string | null;
	createdAt: string;
}

export interface InventoryContext {
	worldId: string | null;
	userId: string | null;
}

export type InventoryAdapterId = 'local' | 'world' | 'cloud';

export interface InventoryAdapter {
	readonly id: InventoryAdapterId;
	readonly label: string;
	isAvailable(ctx: InventoryContext): boolean;
	listFolders(ctx: InventoryContext, parentId: string | null): Promise<InventoryFolder[]>;
	createFolder(ctx: InventoryContext, parentId: string | null, name: string): Promise<InventoryFolder>;
	deleteFolder(ctx: InventoryContext, folderId: string): Promise<void>;
	listItems(ctx: InventoryContext, folderId: string | null): Promise<InventoryItem[]>;
	saveItem(ctx: InventoryContext, folderId: string | null, name: string, slotData: SlotTree, kind?: 'object' | 'world', worldLineageId?: string): Promise<InventoryItem>;
	updateItem?(ctx: InventoryContext, itemId: string, folderId: string | null, name: string, slotData: SlotTree): Promise<InventoryItem>;
	deleteItem(ctx: InventoryContext, itemId: string): Promise<void>;
}
