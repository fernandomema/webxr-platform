import { assetIdOf } from './hash.ts';
import { parseGlb, type GlbLimits } from './glb.ts';
import { ASSET_LIMITS, type AssetManifest } from './manifest.ts';
import type { AssetStore } from './store';

export interface ImportResult {
	manifest: AssetManifest;
	/** True when this exact model was already in the store (nothing was written). */
	alreadyStored: boolean;
}

/** "Chair.glb" -> "Chair"; falls back to a generic name. */
export function modelNameFromFile(fileName: string): string {
	const name = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
	return name.slice(0, 80) || 'Model';
}

/**
 * Validates a .glb, computes its content address and stores it. The address
 * is the SHA-256 of the bytes, so importing the same file twice — or the same
 * model from two places — always resolves to one asset.
 */
export async function importGlb(bytes: Uint8Array, name: string, store: AssetStore, limits: GlbLimits = ASSET_LIMITS): Promise<ImportResult> {
	const stats = parseGlb(bytes, limits);
	const assetId = await assetIdOf(bytes);
	const existing = await store.getManifest(assetId);
	if (existing) return { manifest: existing, alreadyStored: true };

	const manifest: AssetManifest = {
		assetId,
		type: 'model',
		format: 'glb',
		mimeType: 'model/gltf-binary',
		byteSize: bytes.byteLength,
		name: modelNameFromFile(name),
		bounds: stats.bounds,
		triangles: stats.triangles,
		meshes: stats.meshes,
		materials: stats.materials,
		textures: stats.textures
	};
	await store.put(manifest, bytes);
	return { manifest, alreadyStored: false };
}

export async function importGlbFile(file: File, store: AssetStore): Promise<ImportResult> {
	return importGlb(new Uint8Array(await file.arrayBuffer()), file.name, store);
}
