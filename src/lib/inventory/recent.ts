import { availableInventoryFolders, isReadOnlyAdapter } from './registry';
import type { InventoryAdapter, InventoryAdapterId, InventoryContext, InventoryItem } from './types';

export interface RecentProject {
	adapterId: InventoryAdapterId;
	adapterLabel: string;
	item: InventoryItem;
}

/** Folders opened per storage location: enough for a normal inventory, bounded for a huge one. */
const FOLDER_BUDGET = 40;

async function collectItems(adapter: InventoryAdapter, ctx: InventoryContext): Promise<InventoryItem[]> {
	const items: InventoryItem[] = [];
	const queue: Array<string | null> = [null];
	let opened = 0;
	while (queue.length > 0 && opened < FOLDER_BUDGET) {
		const folderId = queue.shift() ?? null;
		opened++;
		items.push(...await adapter.listItems(ctx, folderId));
		for (const folder of await adapter.listFolders(ctx, folderId)) queue.push(folder.id);
	}
	return items;
}

/**
 * The most recently saved worlds, objects and avatars across every storage location the user can write to
 * (this device, the cloud, the open world, a project folder). A world saved many times counts once, at its latest revision.
 * A location that cannot be read is skipped.
 */
export async function listRecentProjects(ctx: InventoryContext, limit: number): Promise<RecentProject[]> {
	// The project folder is left out: listing it can ask for a permission prompt, which a home screen must not trigger.
	const adapters = availableInventoryFolders(ctx).filter((adapter) => !isReadOnlyAdapter(adapter.id) && adapter.id !== 'filesystem');
	const perAdapter = await Promise.all(adapters.map(async (adapter) => {
		try {
			return (await collectItems(adapter, ctx)).map((item): RecentProject => ({ adapterId: adapter.id, adapterLabel: adapter.label, item }));
		} catch {
			return [];
		}
	}));
	const newestFirst = perAdapter.flat().sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
	const seen = new Set<string>();
	const unique = newestFirst.filter(({ adapterId, item }) => {
		const key = `${adapterId}:${item.worldLineageId ?? item.id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return unique.slice(0, limit);
}
