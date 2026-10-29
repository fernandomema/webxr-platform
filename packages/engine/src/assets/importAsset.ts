import { assetIdOf } from './hash.ts';
import { AssetImportError, formatOf, getAssetKind, sniffAssetKind, type AssetKindDef } from './kinds/index.ts';
import type { AssetManifest } from './manifest.ts';
import type { AssetOrigin, AssetStore } from './store.ts';
import type { AssetProvenance } from '../library/provenance.ts';

export interface ImportResult {
	manifest: AssetManifest;
	/** True when this exact asset was already in the store (nothing was written). */
	alreadyStored: boolean;
}

/** "Chair.glb" -> "Chair"; falls back to the kind's default name. */
export function assetNameFromFile(fileName: string, fallback: string): string {
	const name = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
	return name.slice(0, 80) || fallback;
}

export interface ImportOptions {
	/** Only accept this kind (the bytes are then not sniffed, the kind's own validation decides). */
	type?: string;
	/** Kind-specific budgets, passed to the kind's `analyze`. Tests use it to shrink limits. */
	limits?: unknown;
	/** Where the bytes came from, when it was not the user. */
	origin?: AssetOrigin;
	/** Where the file was found, when it came from an external library. Recorded beside the bytes (the asset id does not depend on it). */
	provenance?: AssetProvenance;
}

/**
 * Validates a file as one of the registered kinds, computes its content address
 * and stores it. The address is the SHA-256 of the bytes, so importing the same
 * file twice — or the same asset from two places — always resolves to one asset.
 */
export async function importAsset(bytes: Uint8Array, fileName: string, store: AssetStore, options: ImportOptions = {}): Promise<ImportResult> {
	let kind: AssetKindDef | undefined;
	if (options.type) {
		kind = getAssetKind(options.type);
	} else {
		kind = sniffAssetKind(bytes.subarray(0, 64))?.kind;
		if (!kind) throw new AssetImportError('unsupported', 'This file type is not supported.');
	}
	if (!kind) throw new AssetImportError('unsupported', 'This asset type is not supported.');

	const analysis = await kind.analyze(bytes, fileName, options.limits);
	const assetId = await assetIdOf(bytes);
	const existing = await store.getManifest(assetId);
	if (existing) {
		if (options.origin === 'app' && (existing as { origin?: string }).origin !== 'app') await store.setOrigin(assetId, 'app');
		if (options.provenance && !existing.provenance) await store.setProvenance(assetId, options.provenance);
		return { manifest: existing, alreadyStored: true };
	}

	const format = formatOf(kind, analysis.format as string);
	if (!format) throw new AssetImportError('unsupported', 'This file format is not supported.');
	const manifest = {
		...analysis,
		assetId,
		type: kind.type,
		mimeType: format.mimeType,
		byteSize: bytes.byteLength,
		name: assetNameFromFile(fileName, kind.defaultName),
		...(options.provenance ? { provenance: options.provenance } : {})
	} as AssetManifest;
	await store.put(manifest, bytes, options.origin);
	return { manifest, alreadyStored: false };
}

export async function importAssetFile(file: File, store: AssetStore): Promise<ImportResult> {
	return importAsset(new Uint8Array(await file.arrayBuffer()), file.name, store);
}
