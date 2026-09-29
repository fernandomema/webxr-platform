import type { Slot, SlotTree } from '../ecs/types';

/**
 * How a `meshRenderer` says what to draw. The scene only ever carries this
 * reference: a built-in primitive, or the SHA-256 of a model's bytes. Bytes,
 * signed URLs and `blob:` URLs never appear in a scene.
 */
export const BUILTIN_MESH_IDS = ['box', 'sphere', 'plane', 'ground', 'cylinder', 'disc'] as const;
export type BuiltinMeshId = (typeof BUILTIN_MESH_IDS)[number];

/** `sha256:` followed by 64 lowercase hex characters. */
export type AssetId = `sha256:${string}`;

export type MeshRef = { kind: 'builtin'; id: BuiltinMeshId } | { kind: 'asset'; assetId: AssetId };

const ASSET_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Portals embed whole worlds; nothing legitimate nests deeper than this. */
export const MAX_PORTAL_DEPTH = 4;

export function isBuiltinMeshId(value: unknown): value is BuiltinMeshId {
	return typeof value === 'string' && (BUILTIN_MESH_IDS as readonly string[]).includes(value);
}

export function isAssetId(value: unknown): value is AssetId {
	return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

export const builtinMesh = (id: BuiltinMeshId): MeshRef => ({ kind: 'builtin', id });
export const assetMesh = (assetId: AssetId): MeshRef => ({ kind: 'asset', assetId });

/** A stable string for a reference, for signatures and map keys. */
export function meshRefKey(ref: MeshRef): string {
	return ref.kind === 'asset' ? ref.assetId : `builtin:${ref.id}`;
}

/** Whether a stored meshRef (any form) is the given built-in primitive. */
export function isBuiltinMesh(value: unknown, id: BuiltinMeshId): boolean {
	const ref = normalizeMeshRef(value);
	return ref.kind === 'builtin' && ref.id === id;
}

export function meshRefEquals(a: MeshRef, b: MeshRef): boolean {
	return meshRefKey(a) === meshRefKey(b);
}

/**
 * Reads a `meshRef` in any form it has ever been stored in: the current
 * `{ kind }` object, or the legacy string (a primitive id, or `asset:sha256:…`).
 * Anything unrecognised becomes a box, which is also what the renderer used to
 * do with unknown strings, so old scenes look the same.
 */
export function normalizeMeshRef(value: unknown): MeshRef {
	if (value && typeof value === 'object') {
		const ref = value as { kind?: unknown; id?: unknown; assetId?: unknown };
		if (ref.kind === 'asset' && isAssetId(ref.assetId)) return assetMesh(ref.assetId);
		if (ref.kind === 'builtin' && isBuiltinMeshId(ref.id)) return builtinMesh(ref.id);
		return builtinMesh('box');
	}
	if (typeof value === 'string') {
		if (isBuiltinMeshId(value)) return builtinMesh(value);
		const legacy = value.startsWith('asset:') ? value.slice('asset:'.length) : value;
		if (isAssetId(legacy)) return assetMesh(legacy);
	}
	return builtinMesh('box');
}

type LooseComponent = { type?: unknown; meshRef?: unknown; world?: { scene?: unknown } } & Record<string, unknown>;

/**
 * Returns the tree with every `meshRenderer.meshRef` in the current form,
 * including scenes embedded in world portals. Never mutates its input. Call it
 * on every path that reads a scene from storage or the network; writers always
 * emit the current form.
 */
export function migrateSlotTree(tree: readonly unknown[], depth = 0): SlotTree {
	return tree.map((slot) => {
		if (!slot || typeof slot !== 'object' || !Array.isArray((slot as Slot).components)) return slot as Slot;
		const source = slot as Slot;
		return {
			...source,
			components: source.components.map((raw) => {
				const component = raw as unknown as LooseComponent;
				if (component?.type === 'meshRenderer') return { ...component, meshRef: normalizeMeshRef(component.meshRef) } as unknown as Slot['components'][number];
				if (component?.type === 'worldPortal' && depth < MAX_PORTAL_DEPTH && Array.isArray(component.world?.scene)) {
					return { ...component, world: { ...component.world, scene: migrateSlotTree(component.world.scene, depth + 1) } } as unknown as Slot['components'][number];
				}
				return raw;
			})
		};
	});
}

/** Every model a scene needs, including those inside nested world portals. */
export function collectAssetIds(tree: readonly unknown[], into: Set<AssetId> = new Set(), depth = 0): Set<AssetId> {
	for (const slot of tree) {
		const components = (slot as Partial<Slot> | null)?.components;
		if (!Array.isArray(components)) continue;
		for (const raw of components) {
			const component = raw as unknown as LooseComponent;
			if (component?.type === 'meshRenderer') {
				const ref = normalizeMeshRef(component.meshRef);
				if (ref.kind === 'asset') into.add(ref.assetId);
			} else if (component?.type === 'worldPortal' && depth < MAX_PORTAL_DEPTH && Array.isArray(component.world?.scene)) {
				collectAssetIds(component.world.scene, into, depth + 1);
			}
		}
	}
	return into;
}
