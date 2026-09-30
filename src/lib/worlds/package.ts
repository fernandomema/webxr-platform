import { createSlot, type Slot, type SlotTree } from '$lib/ecs/types';
import type { InventoryStorageAdapterId, InventoryItem } from '$lib/inventory/types';
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import type { WorldPackage, WorldSource } from './types';
import { ASSET_LIMITS } from '$lib/assets/manifest';
import { collectAssetIds, isAssetId, isBuiltinMeshId } from '$lib/assets/ref';

export const MAX_WORLD_BYTES = 1_500_000;
export const MAX_SHARED_SCENE_BYTES = 7_000_000;

/** Treat the scene as data, including reactive Svelte proxies from the Studio. */
export function copyScene(scene: SlotTree): SlotTree {
	return JSON.parse(JSON.stringify(scene)) as SlotTree;
}

export function validateWorldScene(value: unknown): asserts value is SlotTree {
	if (!Array.isArray(value) || value.length === 0 || value.length > 2000) throw new Error('Invalid world scene');
	if (JSON.stringify(value).length > MAX_WORLD_BYTES) throw new Error('World is too large to share');
	const ids = new Set<string>();
	for (const slot of value) {
		if (!slot || typeof slot.id !== 'string' || !slot.id || ids.has(slot.id) || ['dash-panel', 'inspector-panel'].includes(slot.id) ||
			typeof slot.name !== 'string' || !Array.isArray(slot.components) ||
			!Array.isArray(slot.position) || slot.position.length !== 3 ||
			!Array.isArray(slot.rotation) || slot.rotation.length !== 4 ||
			!Array.isArray(slot.scale) || slot.scale.length !== 3) throw new Error('Invalid world slot');
		ids.add(slot.id);
	}
	validateAssetRefs(value as SlotTree);
	for (const slot of value as SlotTree) {
		if (slot.parentId !== null && !ids.has(slot.parentId)) throw new Error('World has a missing parent slot');
		let parentId = slot.parentId;
		const ancestors = new Set([slot.id]);
		while (parentId) {
			if (ancestors.has(parentId)) throw new Error('World hierarchy contains a cycle');
			ancestors.add(parentId);
			parentId = (value as SlotTree).find((candidate) => candidate.id === parentId)?.parentId ?? null;
		}
	}
}

/**
 * A meshRef may still be a legacy string (it is upgraded on read), but never an
 * arbitrary URL for an asset, and a world may only reference a bounded number of models.
 */
function validateAssetRefs(scene: SlotTree): void {
	for (const slot of scene) {
		for (const component of slot.components as unknown as Array<{ type?: string; meshRef?: unknown; source?: unknown; url?: unknown }>) {
			if (component?.type === 'audioPlayer') {
				const source = component.source as { kind?: unknown; url?: unknown; assetId?: unknown } | null | undefined;
				if (source === undefined || source === null) continue; // legacy `url` form; upgraded on read
				const valid = (source.kind === 'asset' && isAssetId(source.assetId)) || (source.kind === 'url' && typeof source.url === 'string' && source.url.length <= 2048);
				if (!valid) throw new Error('Invalid audio source');
				continue;
			}
			if (component?.type !== 'meshRenderer') continue;
			const ref = component.meshRef;
			if (typeof ref === 'string') continue; // legacy form; unknown strings render as a box
			const object = ref as { kind?: unknown; id?: unknown; assetId?: unknown } | null;
			const valid = object && ((object.kind === 'builtin' && isBuiltinMeshId(object.id)) || (object.kind === 'asset' && isAssetId(object.assetId)));
			if (!valid) throw new Error('Invalid mesh reference');
		}
	}
	if (collectAssetIds(scene).size > ASSET_LIMITS.maxAssetsPerWorld) throw new Error('World uses too many assets');
}

export function worldFromInventory(item: InventoryItem, adapterId: InventoryStorageAdapterId, ownerId: string | null): WorldPackage {
	if (item.kind !== 'world') throw new Error('This inventory item is not a world');
	validateWorldScene(item.slotData);
	return {
		formatVersion: 1,
		name: item.name,
		scene: copyScene(item.slotData),
		defaultVisibility: 'private',
		source: { kind: 'inventory', adapterId, itemId: item.id, ownerId, worldLineageId: item.worldLineageId, folderId: item.folderId, revisionNumber: item.revisionNumber }
	};
}

export function createWorldOrb(world: WorldPackage, position: Slot['position']): Slot {
	validateWorldScene(world.scene);
	return createSlot({
		name: `${world.name} world orb`,
		position,
		scale: [0.24, 0.24, 0.24],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#7c3aed' },
			{ type: 'collider', shape: 'sphere' },
			{ type: 'worldPortal', world: JSON.parse(JSON.stringify(world)) as WorldPackage }
		]
	});
}

export function validateWorldPackage(value: unknown): asserts value is WorldPackage {
	if (!value || typeof value !== 'object') throw new Error('Invalid world package');
	const world = value as Partial<WorldPackage>;
	if (world.formatVersion !== 1 || typeof world.name !== 'string' || !world.name.trim() || world.name.length > 120 ||
		!['solo', 'private', 'friends', 'friends-plus', 'public'].includes(world.defaultVisibility ?? '')) throw new Error('Unsupported world package');
	validateWorldScene(world.scene);
}

export function withLaunchVisibility(world: WorldPackage, visibility: HostedWorldVisibility | 'solo'): WorldPackage {
	return { ...world, defaultVisibility: visibility };
}

export function sourceLabel(source?: WorldSource): string {
	if (!source) return 'Snapshot';
	return source.kind === 'published' ? 'Published world · pinned revision' : `${source.adapterId} inventory`;
}
