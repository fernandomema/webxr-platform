import { cloudAssets } from '@kithin/engine/assets/cloud';
import type { AssetId } from '@kithin/engine/assets/ref';
import { getLocalAssetStore, type AssetListing } from '@kithin/engine/assets/store';
import { availableInventoryFolders } from '@kithin/engine/inventory/registry';
import { listDrafts } from '../state/autosave';
import { resolve } from '$app/paths';
import { assetIdsIn, type ContentEntry, type ContentUsage, type UsedIn } from './entries';
import type { InventoryAdapter, InventoryContext } from '@kithin/engine/inventory/types';

/** What can be done with the files kept by one inventory adapter. Adapters that keep no files have no source. */
export interface ContentSource {
	readonly adapterId: string;
	list(): Promise<ContentEntry[]>;
	usage(): Promise<ContentUsage>;
	/** A storage may still refuse a given file, see `isRemovable`. */
	remove(id: AssetId): Promise<void>;
	/** The file's bytes, or null if they cannot be had right now. */
	bytes(id: AssetId): Promise<Uint8Array | null>;
}

/** Every item of an adapter, folders included. Folders are visited breadth first, so a huge tree is cut from the bottom. */
async function allItems(adapter: InventoryAdapter, ctx: InventoryContext, folderBudget = 200) {
	const items = [];
	const queue: Array<string | null> = [null];
	for (let opened = 0; queue.length > 0 && opened < folderBudget; opened++) {
		const folderId = queue.shift() ?? null;
		items.push(...await adapter.listItems(ctx, folderId));
		for (const folder of await adapter.listFolders(ctx, folderId)) queue.push(folder.id);
	}
	return items;
}

const editHref = (params: Record<string, string>): string => `${resolve('/studio/edit')}?${new URLSearchParams(params)}`;

interface References {
	items: number;
	worlds: number;
	in: UsedIn[];
}

/**
 * Which objects and worlds mention each asset, wherever they are kept: every storage that can be read without asking
 * (this device, the cloud, the project folder when it is connected, the starter kit) and the drafts not saved yet.
 * A storage that cannot be read right now simply adds nothing.
 */
async function localReferences(ctx: InventoryContext): Promise<Map<AssetId, References>> {
	const used = new Map<AssetId, References>();
	const slotOf = new Map<string, unknown>();
	const note = (ids: Iterable<AssetId>, world: boolean, entry: UsedIn, thumbnail?: AssetId) => {
		for (const id of ids) {
			const count = used.get(id) ?? { items: 0, worlds: 0, in: [] };
			if (world) count.worlds++;
			else count.items++;
			const here = id === thumbnail && !assetIdsIn(slotOf.get(entry.label)).has(id) ? { ...entry, preview: true } : entry;
			if (!count.in.some((known) => known.label === entry.label)) count.in.push(here);
			used.set(id, count);
		}
	};
	// Where every saved item can be opened from, so a draft of one links to it.
	const opens = new Map<string, string>();
	const adapters = availableInventoryFolders(ctx).filter((adapter) => adapter.id !== 'world');
	await Promise.all(adapters.map(async (adapter) => {
		try {
			for (const item of await allItems(adapter, ctx)) {
				const href = editHref({ source: adapter.id, folder: item.folderId ?? 'root', item: item.id });
				opens.set(`item:${adapter.id}:${item.id}`, href);
				if (item.worldLineageId) opens.set(`lineage:${item.worldLineageId}`, href);
				slotOf.set(`${item.name} (${adapter.label})`, item.slotData);
				const ids = assetIdsIn(item.slotData);
				if (item.thumbnailAssetId) ids.add(item.thumbnailAssetId);
				note(ids, item.kind === 'world', { label: `${item.name} (${adapter.label})`, href, name: item.name }, item.thumbnailAssetId ?? undefined);
			}
		} catch {
			// Not readable now (signed out, folder not reconnected).
		}
	}));
	for (const draft of await listDrafts()) {
		const href = draft.key.startsWith('new:')
			? editHref({ template: draft.kind === 'world' ? 'blank-world' : 'blank-object', draft: draft.key.slice(4) })
			: opens.get(draft.key);
		note(assetIdsIn(draft.tree), draft.kind === 'world', { label: `${draft.name} (unsaved draft)`, href, name: draft.name });
	}
	return used;
}

/** Copies that come back by themselves: downloads, and the preview pictures the app draws of worlds and objects (including those stored before origins were recorded). */
function isRegenerable(listing: AssetListing): boolean {
	return listing.origin === 'download' || listing.origin === 'generated' || (listing.type === 'image' && /(^| )preview$/i.test(listing.name));
}

function localSource(ctx: InventoryContext): ContentSource {
	const store = getLocalAssetStore();
	return {
		adapterId: 'local',
		async list() {
			const [listings, used] = await Promise.all([store.list(), localReferences(ctx)]);
			return listings.map((listing) => ({
				assetId: listing.assetId,
				manifest: listing,
				addedAt: listing.importedAt,
				lastUsedAt: listing.lastUsedAt,
				cached: isRegenerable(listing),
				builtin: listing.origin === 'app',
				usedIn: used.get(listing.assetId)?.in,
				usedBy: { items: used.get(listing.assetId)?.items ?? 0, worlds: used.get(listing.assetId)?.worlds ?? 0, publications: 0 }
			}));
		},
		async usage() {
			const { count, bytes } = await store.usage();
			return { count, bytes, quota: 0 };
		},
		remove: (id) => store.delete(id),
		async bytes(id) {
			return (await store.getBytes(id)) ?? null;
		}
	};
}

function cloudSource(): ContentSource {
	return {
		adapterId: 'cloud',
		async list() {
			return (await cloudAssets.list()).map((asset) => ({
				assetId: asset.assetId,
				manifest: asset.manifest,
				addedAt: Date.parse(asset.ownedSince) || null,
				lastUsedAt: null,
				cached: false,
				builtin: false,
				profile: asset.profile,
				usedIn: [
					...(asset.profile ? [{ label: 'Profile picture (your account)', name: 'Profile picture', href: resolve('/settings') }] : []),
					...(asset.worlds ?? []).map((world) => ({ label: `${world.name} (hosted world)`, name: world.name, href: `${resolve('/play')}?world=${encodeURIComponent(world.id)}`, preview: world.preview }))
				],
				usedBy: asset.usedIn
			}));
		},
		async usage() {
			const { bytes, count, quota, assetBytes, inventoryBytes } = await cloudAssets.usage();
			return { bytes, count, quota, parts: [{ label: 'Files', bytes: assetBytes }, { label: 'Saved objects and worlds', bytes: inventoryBytes }] };
		},
		remove: (id) => cloudAssets.release(id),
		async bytes(id) {
			const entry = (await cloudAssets.resolve([id]))[id];
			if (!entry) return null;
			const response = await fetch(entry.url);
			return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
		}
	};
}

/** The content source of an inventory adapter, or undefined when that adapter keeps no files of its own. */
export function contentSourceFor(adapterId: string, ctx: InventoryContext): ContentSource | undefined {
	if (adapterId === 'local') return localSource(ctx);
	if (adapterId === 'cloud') return cloudSource();
	return undefined;
}
