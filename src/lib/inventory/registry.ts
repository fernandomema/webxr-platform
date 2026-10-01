import type { InventoryAdapter, InventoryContext } from './types';
import { localInventoryAdapter } from './adapters/local';
import { worldInventoryAdapter } from './adapters/world';
import { cloudInventoryAdapter } from './adapters/cloud';
import { purchasedInventoryAdapter } from './adapters/purchased';
import { builtinInventoryAdapter } from './adapters/builtin';
import { filesystemInventoryAdapter } from './adapters/filesystem';

const ALL: InventoryAdapter[] = [localInventoryAdapter, worldInventoryAdapter, cloudInventoryAdapter, purchasedInventoryAdapter, builtinInventoryAdapter, ...(import.meta.env.DEV ? [filesystemInventoryAdapter] : [])];

/** The root folders to show in the Dash "Inventory" tab for the current context. */
export function availableInventoryFolders(ctx: InventoryContext): InventoryAdapter[] {
	return ALL.filter((adapter) => adapter.isAvailable(ctx));
}

/** Marketplace purchases and the starter kit can be opened and copied, but nothing is saved or published back to them. */
export function isReadOnlyAdapter(id: string | null): id is 'purchased' | 'builtin' {
	return id === 'purchased' || id === 'builtin';
}

export function getInventoryAdapter(id: string): InventoryAdapter | undefined {
	return ALL.find((adapter) => adapter.id === id);
}
