import type { AssetManifest } from '@kithin/engine/assets/manifest';
import type { AssetId } from '@kithin/engine/assets/ref';
import { parseAssetRef } from '@kithin/engine/library/ref';
import type { AssetProvenance } from '@kithin/engine/library/provenance';
import type { AssetDetail, AssetKind, FileRole, Variant } from '@kithin/engine/library/types';
import { pickVariant } from '@kithin/engine/library/variants';

/**
 * Takes an asset found in an external library and puts it into the person's own assets, ready to use. There is one importer per kind
 * of asset; they know nothing about where the asset came from, only about its files. Everything the browser does (download, convert,
 * store) comes in through `ImportDeps`, so the rules here run the same in a test.
 */
export interface ImportDeps {
	download(ref: string, variantId: string, role: FileRole, index?: number, signal?: AbortSignal): Promise<Uint8Array>;
	/** Re-encodes a map as WebP at a sensible size. `mimeType` is `image/png` where the browser can not encode WebP. */
	optimizeMap(bytes: Uint8Array, map: 'albedo' | 'normal' | 'arm'): Promise<{ bytes: Uint8Array; mimeType: string }>;
	/** Packs separate occlusion, roughness and metallic maps into one ARM map (R, G, B). */
	packArm(maps: { ao?: Uint8Array; roughness?: Uint8Array; metallic?: Uint8Array }): Promise<{ bytes: Uint8Array; mimeType: string }>;
	store(bytes: Uint8Array, fileName: string, type: string, provenance: AssetProvenance): Promise<AssetManifest>;
	/** Makes a model, a picture or a sound lighter (WebP textures, a lighter WAV…), or answers null when it can not do better. */
	optimizeFile(kind: 'model' | 'image' | 'audio', bytes: Uint8Array): Promise<{ bytes: Uint8Array; extension: string } | null>;
}

export interface ImportOptions {
	/** The variant to take; otherwise the best match for `resolution`. */
	variantId?: string;
	resolution?: string;
	/** Make the file lighter before keeping it, as far as its kind allows. Materials are always optimized, so it changes nothing for them. */
	optimize?: boolean;
	signal?: AbortSignal;
}

/** What optimizing did to the size of the file. `after` equals `before` when it was already as light as it gets. */
export interface Optimized { before: number; after: number }

export type ImportResult =
	| { kind: 'material'; name: string; albedo: AssetId | null; normal: AssetId | null; arm: AssetId | null; size: number; bytes: { downloaded: number; stored: number } }
	| { kind: 'model'; name: string; assetId: AssetId; triangles: number; size: number; byteSize: number; optimized?: Optimized }
	| { kind: 'audio'; name: string; assetId: AssetId; byteSize: number; optimized?: Optimized }
	| { kind: 'image'; name: string; assetId: AssetId; byteSize: number; optimized?: Optimized };

export function provenanceOf(detail: AssetDetail, now = Date.now()): AssetProvenance {
	const source = parseAssetRef(detail.ref)?.source ?? 'unknown';
	// Built field by field, as plain data: the detail may be reactive state, and a proxy can not be stored in IndexedDB.
	const { license } = detail;
	return {
		source, ref: detail.ref, sourceUrl: detail.sourceUrl, ...(detail.author ? { author: detail.author } : {}),
		license: { name: license.name, ...(license.url ? { url: license.url } : {}), commercialUse: license.commercialUse, attributionRequired: license.attributionRequired },
		importedAt: now
	};
}

const filesOf = (variant: Variant, role: FileRole) => variant.files.filter((file) => file.role === role);
const has = (variant: Variant, role: FileRole) => filesOf(variant, role).length > 0;

type Importer = (detail: AssetDetail, variant: Variant, deps: ImportDeps, options: ImportOptions) => Promise<ImportResult>;

const importMaterial: Importer = async (detail, variant, deps, options) => {
	const provenance = provenanceOf(detail);
	const result = { kind: 'material' as const, name: detail.title, albedo: null as AssetId | null, normal: null as AssetId | null, arm: null as AssetId | null, size: detail.facts?.realWorldSize ?? 1, bytes: { downloaded: 0, stored: 0 } };
	const keep = async (map: 'albedo' | 'normal' | 'arm', bytes: Uint8Array, downloaded: number) => {
		const optimized = await deps.optimizeMap(bytes, map);
		const manifest = await deps.store(optimized.bytes, `${detail.title} ${map}.${optimized.mimeType === 'image/webp' ? 'webp' : 'png'}`, 'image', provenance);
		result[map] = manifest.assetId;
		result.bytes.downloaded += downloaded;
		result.bytes.stored += optimized.bytes.byteLength;
	};
	const jobs: Promise<void>[] = [];
	for (const map of ['albedo', 'normal', 'arm'] as const) {
		if (map === 'arm' && !has(variant, 'arm') && (has(variant, 'ao') || has(variant, 'roughness') || has(variant, 'metallic'))) continue;
		if (has(variant, map)) jobs.push(deps.download(detail.ref, variant.id, map, 0, options.signal).then((bytes) => keep(map, bytes, bytes.byteLength)));
	}
	// Separate occlusion / roughness / metallic maps become the one ARM map the engine reads.
	if (!has(variant, 'arm') && (has(variant, 'ao') || has(variant, 'roughness') || has(variant, 'metallic'))) {
		jobs.push((async () => {
			const fetched: { ao?: Uint8Array; roughness?: Uint8Array; metallic?: Uint8Array } = {};
			let downloaded = 0;
			for (const role of ['ao', 'roughness', 'metallic'] as const) {
				if (!has(variant, role)) continue;
				// A map a provider lists but does not always have (metallic on a non-metal) is simply left out.
				try { fetched[role] = await deps.download(detail.ref, variant.id, role, 0, options.signal); } catch (error) { if (options.signal?.aborted) throw error; continue; }
				downloaded += fetched[role]!.byteLength;
			}
			if (!Object.keys(fetched).length) return;
			const packed = await deps.packArm(fetched);
			const manifest = await deps.store(packed.bytes, `${detail.title} arm.${packed.mimeType === 'image/webp' ? 'webp' : 'png'}`, 'image', provenance);
			result.arm = manifest.assetId;
			result.bytes.downloaded += downloaded;
			result.bytes.stored += packed.bytes.byteLength;
		})());
	}
	if (!jobs.length) throw new Error('This material has no maps that can be imported.');
	await Promise.all(jobs);
	return result;
};

/** The file as it will be kept: lighter when asked and when that really is lighter, and what that did to its size. */
async function maybeOptimized(kind: 'model' | 'image' | 'audio', bytes: Uint8Array, extension: string, deps: ImportDeps, options: ImportOptions): Promise<{ bytes: Uint8Array; extension: string; optimized?: Optimized }> {
	if (!options.optimize) return { bytes, extension };
	let better: { bytes: Uint8Array; extension: string } | null = null;
	try { better = await deps.optimizeFile(kind, bytes); } catch (error) { if (options.signal?.aborted) throw error; }
	return better && better.bytes.byteLength < bytes.byteLength ? { ...better, optimized: { before: bytes.byteLength, after: better.bytes.byteLength } } : { bytes, extension, optimized: { before: bytes.byteLength, after: bytes.byteLength } };
}

const importModel: Importer = async (detail, variant, deps, options) => {
	const downloaded = await deps.download(detail.ref, variant.id, 'model', 0, options.signal);
	const { bytes, optimized } = await maybeOptimized('model', downloaded, 'glb', deps, options);
	const manifest = await deps.store(bytes, `${detail.title}.glb`, 'model', provenanceOf(detail));
	if (manifest.type !== 'model') throw new Error('The file is not a model.');
	const [min, max] = [manifest.bounds.min, manifest.bounds.max];
	const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	return { kind: 'model', name: detail.title, assetId: manifest.assetId, triangles: manifest.triangles, size: Number.isFinite(size) ? size : 1, byteSize: manifest.byteSize, ...(optimized ? { optimized } : {}) };
};

function simpleImporter(kind: 'audio' | 'image', role: FileRole): Importer {
	return async (detail, variant, deps, options) => {
		const downloaded = await deps.download(detail.ref, variant.id, role, 0, options.signal);
		const { bytes, extension, optimized } = await maybeOptimized(kind, downloaded, variant.files.find((file) => file.role === role)?.format ?? 'bin', deps, options);
		const manifest = await deps.store(bytes, `${detail.title}.${extension}`, kind, provenanceOf(detail));
		return { kind, name: detail.title, assetId: manifest.assetId, byteSize: manifest.byteSize, ...(optimized ? { optimized } : {}) };
	};
}

/** What can be imported today. A kind without an importer can still be browsed and opened on its own site. */
const IMPORTERS: Partial<Record<AssetKind, Importer>> = {
	material: importMaterial,
	model: importModel,
	audio: simpleImporter('audio', 'audio'),
	image: simpleImporter('image', 'image')
};

export const canImportKind = (kind: AssetKind): boolean => kind in IMPORTERS;

/** Kinds that have an "add optimized" (a material is always optimized, so it has no separate option). */
export const canOptimizeKind = (kind: AssetKind): boolean => kind === 'model' || kind === 'image' || kind === 'audio';

/** The variant an import will use: the one asked for, or the best match (GLB first for models; the closest size otherwise). */
export function variantFor(detail: AssetDetail, options: ImportOptions = {}): Variant | null {
	if (options.variantId) return detail.variants.find((variant) => variant.id === options.variantId && !variant.unsupported) ?? null;
	return pickVariant(detail.variants, { resolution: options.resolution ?? '1k', formats: detail.kind === 'model' ? ['glb', 'gltf'] : undefined });
}

export async function importFromLibrary(detail: AssetDetail, deps: ImportDeps, options: ImportOptions = {}): Promise<ImportResult> {
	const importer = IMPORTERS[detail.kind];
	if (!importer) throw new Error(`Importing ${detail.kind} assets is not available yet.`);
	if (!detail.downloadable) throw new Error('This asset has to be taken from its own site.');
	const variant = variantFor(detail, options);
	if (!variant) {
		const blocked = detail.variants.find((candidate) => candidate.unsupported)?.unsupported;
		throw new Error(blocked ?? 'There is no version of this asset that can be imported.');
	}
	return importer(detail, variant, deps, options);
}
