import type { SlotTree } from '@kithin/engine/ecs/types';
import { CloudResolver } from '@kithin/engine/assets/cloud';
import { ensureCloudAssets } from '@kithin/engine/assets/cloudSync';
import { getLocalAssetStore } from '@kithin/engine/assets/store';
import { CONTAINER_EXTENSIONS, CONTAINER_MIME_TYPE, exportContainer, importContainer, ContainerError, type ContainerKind } from '@kithin/engine/container/kithinFile';
import { ZipError } from '@kithin/engine/container/zip';
import { getInventoryAdapter } from '@kithin/engine/inventory/registry';
import type { InventoryContext, InventoryItem, InventoryKind } from '@kithin/engine/inventory/types';
import { cloneTree, getSlot, subtreeIds } from '@kithin/engine/document/tree';
import { isAvatarTree } from '@kithin/engine/xr/avatar/build';
import type { StudioProject } from './project.svelte';

/** What an `<input type="file">` should accept to pick a Kithin file. */
export const CONTAINER_ACCEPT = CONTAINER_EXTENSIONS.join(',');

function saveToDisk(bytes: Uint8Array, fileName: string): void {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: CONTAINER_MIME_TYPE }));
	const link = document.createElement('a');
	link.href = url;
	link.download = fileName;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The container kind of what the project holds: a world, an avatar (one body with an avatar component) or any other object. */
export function containerKindOf(kind: 'world' | 'object', tree: SlotTree): ContainerKind {
	return kind === 'world' ? 'world' : isAvatarTree(tree) ? 'avatar' : 'object';
}

/** Downloads the open project as a Kithin file, with every asset it uses. Returns what could not be included. */
export async function exportProjectFile(project: StudioProject, userId: string | null, nodeId?: string): Promise<{ fileName: string; assetCount: number; missing: number }> {
	const { doc } = project;
	const whole = cloneTree(doc.tree);
	const root = nodeId ? getSlot(whole, nodeId) : undefined;
	if (nodeId && !root) throw new Error('That object no longer exists.');
	// One node: it and everything under it, as an object of its own. It becomes a root and sits at the origin, so it lands where it is placed.
	const tree = root ? whole.filter((slot) => subtreeIds(whole, root.id).has(slot.id)).map((slot) => (slot.id === root.id ? { ...slot, parentId: null, position: [0, 0, 0] as typeof slot.position } : slot)) : whole;
	const result = await exportContainer(
		root
			? { kind: containerKindOf('object', tree), name: root.name, scene: tree }
			: { kind: containerKindOf(doc.kind, tree), name: doc.name, scene: tree, thumbnail: project.item?.thumbnailAssetId ?? null },
		getLocalAssetStore(),
		{ resolvers: userId ? [new CloudResolver()] : [] }
	);
	saveToDisk(result.bytes, result.fileName);
	return { fileName: result.fileName, assetCount: result.assetCount, missing: result.missing.length };
}

export interface ImportSummary {
	item: InventoryItem;
	kind: ContainerKind;
	added: number;
	missing: number;
}

/** Reads a Kithin file, puts its assets on this device and saves its content as a new item in the given library location. */
export async function importProjectFile(file: File, target: { adapterId: string; folderId: string | null; context: InventoryContext }): Promise<ImportSummary> {
	const adapter = getInventoryAdapter(target.adapterId);
	if (!adapter?.saveItem) throw new Error('This location is read-only. Choose another one to import into.');
	let imported;
	try {
		imported = await importContainer(new Uint8Array(await file.arrayBuffer()), getLocalAssetStore());
	} catch (error) {
		if (error instanceof ContainerError || error instanceof ZipError) throw new Error(error.message);
		throw error;
	}
	if (target.adapterId === 'cloud') await ensureCloudAssets(imported.scene, getLocalAssetStore(), { extraIds: imported.thumbnail ? [imported.thumbnail] : [] });
	const kind: InventoryKind = imported.kind;
	const item = await adapter.saveItem(target.context, target.folderId, imported.name, imported.scene, kind, undefined, imported.thumbnail);
	return { item, kind: imported.kind, added: imported.added, missing: imported.missing.length };
}
