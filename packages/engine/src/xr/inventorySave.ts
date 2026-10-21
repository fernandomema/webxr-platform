import type { SlotTree } from '../ecs/types.ts';
import type { InventoryAdapter, InventoryContext, InventoryItem, InventoryKind } from '../inventory/types.ts';
import { captureItemThumbnail } from './thumbnail/capture.ts';

/**
 * Saves something from the game into an inventory, with a preview of it. The preview is made on this device first and
 * handed to the inventory, which decides where it lives: on the device for a local item, in the cloud too for a cloud item.
 * A preview that cannot be made never stops the save.
 */
export async function saveWithPreview(
	adapter: InventoryAdapter,
	ctx: InventoryContext,
	folderId: string | null,
	name: string,
	tree: SlotTree,
	kind: InventoryKind,
	worldLineageId?: string
): Promise<InventoryItem> {
	if (!adapter.saveItem) throw new Error('This inventory is read-only');
	const thumbnail = await captureItemThumbnail(tree, kind, { name });
	return adapter.saveItem(ctx, folderId, name, tree, kind, worldLineageId, thumbnail ?? undefined);
}
