import type { InventoryAdapter, InventoryContext, InventoryStorageAdapterId } from './types.ts';
import { localInventoryAdapter } from './adapters/local.ts';
import { worldInventoryAdapter } from './adapters/world.ts';
import { cloudInventoryAdapter } from './adapters/cloud.ts';
import { purchasedInventoryAdapter } from './adapters/purchased.ts';
import { builtinInventoryAdapter } from './adapters/builtin.ts';
import { filesystemInventoryAdapter } from './adapters/filesystem.ts';
import { worldStorageInventoryAdapter } from './adapters/worldStorage.ts';

const ALL: InventoryAdapter[] = [localInventoryAdapter, worldInventoryAdapter, cloudInventoryAdapter, worldStorageInventoryAdapter, purchasedInventoryAdapter, builtinInventoryAdapter, ...(import.meta.env.DEV ? [filesystemInventoryAdapter] : [])];

/** The root folders to show in the Dash "Inventory" tab for the current context. */
export function availableInventoryFolders(ctx: InventoryContext): InventoryAdapter[] {
	return ALL.filter((adapter) => adapter.isAvailable(ctx));
}

/** Marketplace purchases and the starter kit can be opened and copied, but nothing is saved or published back to them. */
export function isReadOnlyAdapter(id: string | null): id is 'purchased' | 'builtin' {
	return id === 'purchased' || id === 'builtin';
}

/** Worlds can be saved in, launched from and placed from these; world storage holds objects only, and the read-only ones cannot be saved into. */
export function canHoldWorlds(id: string | null): id is InventoryStorageAdapterId {
	return id !== null && id !== 'worldStorage' && !isReadOnlyAdapter(id);
}

export function getInventoryAdapter(id: string): InventoryAdapter | undefined {
	return ALL.find((adapter) => adapter.id === id);
}
