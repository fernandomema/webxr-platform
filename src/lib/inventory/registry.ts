import type { InventoryAdapter, InventoryContext } from './types';
import { localInventoryAdapter } from './adapters/local';
import { worldInventoryAdapter } from './adapters/world';
import { cloudInventoryAdapter } from './adapters/cloud';
import { purchasedInventoryAdapter } from './adapters/purchased';
import { filesystemInventoryAdapter } from './adapters/filesystem';

const ALL: InventoryAdapter[] = [localInventoryAdapter, worldInventoryAdapter, cloudInventoryAdapter, purchasedInventoryAdapter, ...(import.meta.env.DEV ? [filesystemInventoryAdapter] : [])];

/** The root folders to show in the Dash "Inventory" tab for the current context. */
export function availableInventoryFolders(ctx: InventoryContext): InventoryAdapter[] {
	return ALL.filter((adapter) => adapter.isAvailable(ctx));
}

export function getInventoryAdapter(id: string): InventoryAdapter | undefined {
	return ALL.find((adapter) => adapter.id === id);
}
