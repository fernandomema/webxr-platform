import type { GlbLimits } from './glb.ts';
import { assetNameFromFile, importAsset, type ImportResult } from './importAsset.ts';
import type { AssetStore } from './store.ts';
import type { AssetProvenance } from '../library/provenance.ts';

export type { ImportResult };

/** "Chair.glb" -> "Chair"; falls back to a generic name. */
export const modelNameFromFile = (fileName: string) => assetNameFromFile(fileName, 'Model');

/** Imports a .glb model. A thin wrapper over the generic `importAsset`. */
export function importGlb(bytes: Uint8Array, name: string, store: AssetStore, limits?: GlbLimits, provenance?: AssetProvenance): Promise<ImportResult> {
	return importAsset(bytes, name, store, { type: 'model', limits, ...(provenance ? { provenance } : {}) });
}

export async function importGlbFile(file: File, store: AssetStore): Promise<ImportResult> {
	return importGlb(new Uint8Array(await file.arrayBuffer()), file.name, store);
}
