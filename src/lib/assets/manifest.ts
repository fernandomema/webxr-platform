import type { Vec3 } from '../ecs/types';
import type { AssetId } from './ref';

/** What is known about a model without loading it. Computed at import and stored beside the bytes. */
export interface AssetManifest {
	assetId: AssetId;
	type: 'model';
	format: 'glb';
	mimeType: 'model/gltf-binary';
	byteSize: number;
	name: string;
	/** Axis-aligned bounds of the model in its own units, before normalisation. */
	bounds: { min: Vec3; max: Vec3 };
	triangles: number;
	meshes: number;
	materials: number;
	textures: number;
}

/** Where a peer can get the bytes from: the cloud, or (only) the host of the current session. */
export type AssetAvailability = 'cloud' | 'host';

/** The small description shipped in snapshots and world packages so placeholders can be sized before any download. */
export interface AssetSummary {
	assetId: AssetId;
	byteSize: number;
	bounds: { min: Vec3; max: Vec3 };
	availability: AssetAvailability;
}

/** Import budgets. They protect standalone headsets, and are re-checked on everything received. */
export const ASSET_LIMITS = {
	maxBytes: 25 * 1024 * 1024,
	maxTriangles: 300_000,
	maxImages: 16,
	/** Distinct models a single world may reference. */
	maxAssetsPerWorld: 64
} as const;

const HEX_ID = /^sha256:[0-9a-f]{64}$/;

/**
 * Checks a manifest received from a client before the server records it. The
 * server never trusts sizes it did not measure itself: `byteSize` is checked
 * against the stored object when the upload completes.
 */
export function validateManifest(value: unknown): AssetManifest {
	const m = value as Partial<AssetManifest> | null;
	const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
	if (!m || typeof m !== 'object') throw new Error('Invalid model manifest');
	if (typeof m.assetId !== 'string' || !HEX_ID.test(m.assetId)) throw new Error('Invalid model id');
	if (m.type !== 'model' || m.format !== 'glb' || m.mimeType !== 'model/gltf-binary') throw new Error('Only .glb models are supported');
	if (!Number.isInteger(m.byteSize) || (m.byteSize as number) <= 0) throw new Error('Invalid model size');
	if ((m.byteSize as number) > ASSET_LIMITS.maxBytes) throw new Error('The model is too large');
	if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 120) throw new Error('Invalid model name');
	if (!m.bounds || !isVec(m.bounds.min) || !isVec(m.bounds.max)) throw new Error('Invalid model bounds');
	for (const key of ['triangles', 'meshes', 'materials', 'textures'] as const) {
		if (!Number.isInteger(m[key]) || (m[key] as number) < 0) throw new Error(`Invalid model ${key}`);
	}
	if ((m.triangles as number) > ASSET_LIMITS.maxTriangles) throw new Error('The model has too many triangles');
	return m as AssetManifest;
}
