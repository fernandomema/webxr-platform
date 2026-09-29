import { migrateSlotTree } from '$lib/assets/ref';
import type { InventoryItem } from './types';

/** Items stored before `meshRef` became a `{ kind }` reference are upgraded as they are read. */
export function migrateItem(item: InventoryItem): InventoryItem {
	return { ...item, slotData: migrateSlotTree(item.slotData) };
}

export function migrateItems(items: InventoryItem[]): InventoryItem[] {
	return items.map(migrateItem);
}
