import type { SlotTree } from '../ecs/types.ts';
import { assetIdOf } from '../assets/hash.ts';
import { importAsset } from '../assets/importAsset.ts';
import { formatOf, getAssetKind } from '../assets/kinds/index.ts';
import type { AssetManifest } from '../assets/manifest.ts';
import { collectAssetIds, isAssetId, type AssetId } from '../assets/ref.ts';
import { resolveAsset, type AssetResolver } from '../assets/resolve.ts';
import type { AssetStore } from '../assets/store.ts';
import { validateWorldScene } from '../worlds/package.ts';
import { looksLikeZip, readZipDirectory, readZipEntry, writeZip, ZipError, type ZipEntryInput } from './zip.ts';

/**
 * Kithin's own file format: one file that holds a world, an object or an avatar together with everything it needs (models, sounds,
 * pictures, baked lighting, scene fragments), so it can be moved between devices, accounts and installations and still work.
 *
 *   .kiw  a world         .kin  an object (a "node")         .kia  an avatar
 *
 * It is a ZIP archive, so any archive tool can open one:
 *
 *   kithin.json            the manifest: format, kind, name and the list of assets with their manifests
 *   scene.json             the slot tree
 *   assets/<sha256>.<ext>  one entry per asset, named by the content address the scene refers to it by
 *
 * Assets are content-addressed, so an asset used a hundred times is stored once, a file can be checked for damage entry by entry,
 * and importing it on a device that already has some of the assets stores only the rest. Worlds inside portals travel inside the
 * scene, and their assets are collected with the rest.
 */
export const CONTAINER_FORMAT = 'kithin-container';
export const CONTAINER_VERSION = 1;

export type ContainerKind = 'world' | 'object' | 'avatar';

export const CONTAINER_KINDS: Record<ContainerKind, { extension: string; label: string }> = {
	world: { extension: '.kiw', label: 'World' },
	object: { extension: '.kin', label: 'Object' },
	avatar: { extension: '.kia', label: 'Avatar' }
};

export const CONTAINER_EXTENSIONS = Object.values(CONTAINER_KINDS).map((kind) => kind.extension);
export const CONTAINER_MIME_TYPE = 'application/x-kithin-container';

export const CONTAINER_LIMITS = {
	/** The whole file. A world is at most `ASSET_LIMITS.maxAssetsPerWorld` assets of up to `ASSET_LIMITS.maxBytes` each; real ones are far smaller. */
	maxBytes: 512 * 1024 * 1024,
	maxSceneBytes: 8 * 1024 * 1024,
	maxManifestBytes: 4 * 1024 * 1024,
	maxSlots: 20_000,
	maxAssets: 512
} as const;

export class ContainerError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'ContainerError';
	}
}

export interface ContainerManifest {
	format: typeof CONTAINER_FORMAT;
	version: number;
	kind: ContainerKind;
	name: string;
	/** The picture that stands for the item (an `image` asset in `assets`). */
	thumbnail?: AssetId;
	/** Informational: what wrote the file. */
	generator?: string;
	/** Every asset in the file, by content address. */
	assets: ContainerAsset[];
}

export interface ContainerAsset {
	assetId: AssetId;
	/** The asset's own manifest as the exporting device knew it. Only a hint: the importing device measures the bytes itself. */
	manifest: AssetManifest;
}

export interface ContainerContent {
	kind: ContainerKind;
	name: string;
	scene: SlotTree;
	thumbnail?: AssetId | null;
}

export interface ExportOptions {
	/** Where to look for assets this device does not have (the cloud, a session host). */
	resolvers?: AssetResolver[];
	signal?: AbortSignal;
	onProgress?: (progress: { done: number; total: number; name: string }) => void;
}

export interface ExportResult {
	bytes: Uint8Array;
	fileName: string;
	assetCount: number;
	/** Assets the scene uses that could not be found anywhere, so the file does not carry them. */
	missing: AssetId[];
}

const assetPath = (id: AssetId, extension: string) => `assets/${id.slice('sha256:'.length)}${extension}`;
const ASSET_PATH_PATTERN = /^assets\/([0-9a-f]{64})(\.[a-z0-9.]{1,16})?$/;

/** Formats whose bytes are already compressed; deflating them again only costs time. */
const COMPRESSED_FORMATS = new Set(['mp3', 'ogg', 'png', 'webp']);

function extensionOf(manifest: AssetManifest): string {
	const kind = getAssetKind(manifest.type);
	return (kind && formatOf(kind, manifest.format)?.extensions[0]) ?? '';
}

/** "My world!" -> "My world": a name that is safe to use as a file name on every system. */
export function containerFileName(name: string, kind: ContainerKind): string {
	const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').slice(0, 80).trim();
	return `${clean || CONTAINER_KINDS[kind].label}${CONTAINER_KINDS[kind].extension}`;
}

/** Every asset the content needs, including what scene fragments use in turn. Ones the store has never heard of are returned as `unknown`. */
async function assetClosure(scene: SlotTree, extra: readonly AssetId[], store: AssetStore): Promise<AssetId[]> {
	const found = new Set<AssetId>([...collectAssetIds(scene), ...extra]);
	const queue = [...found];
	while (queue.length) {
		const id = queue.pop()!;
		const manifest = await store.getManifest(id);
		if (manifest?.type !== 'fragment') continue;
		for (const inner of manifest.assets) {
			if (found.has(inner)) continue;
			found.add(inner);
			queue.push(inner);
		}
	}
	return [...found].sort();
}

/** Packs content and all the assets it uses into a container file. */
export async function exportContainer(content: ContainerContent, store: AssetStore, options: ExportOptions = {}): Promise<ExportResult> {
	const scene = JSON.parse(JSON.stringify(content.scene)) as SlotTree;
	const ids = await assetClosure(scene, content.thumbnail ? [content.thumbnail] : [], store);
	const assets: ContainerAsset[] = [];
	const entries: ZipEntryInput[] = [];
	const missing: AssetId[] = [];
	let done = 0;
	for (const id of ids) {
		options.onProgress?.({ done: done++, total: ids.length, name: (await store.getManifest(id))?.name ?? 'Asset' });
		const result = await resolveAsset(id, options.resolvers ?? [], store, { signal: options.signal });
		const manifest = result.ok ? await store.getManifest(id) : undefined;
		if (!result.ok || !manifest) {
			missing.push(id);
			continue;
		}
		const { importedAt: _importedAt, lastUsedAt: _lastUsedAt, origin: _origin, ...clean } = manifest as AssetManifest & { importedAt?: number; lastUsedAt?: number; origin?: string };
		assets.push({ assetId: id, manifest: clean as AssetManifest });
		entries.push({ path: assetPath(id, extensionOf(manifest)), data: result.bytes, compress: !COMPRESSED_FORMATS.has(manifest.format) });
	}
	if (content.thumbnail && missing.includes(content.thumbnail)) content = { ...content, thumbnail: null };

	const manifest: ContainerManifest = {
		format: CONTAINER_FORMAT,
		version: CONTAINER_VERSION,
		kind: content.kind,
		name: content.name.trim().slice(0, 120) || CONTAINER_KINDS[content.kind].label,
		...(content.thumbnail ? { thumbnail: content.thumbnail } : {}),
		generator: 'kithin',
		assets
	};
	const encoder = new TextEncoder();
	const bytes = await writeZip([
		{ path: 'kithin.json', data: encoder.encode(JSON.stringify(manifest, null, '\t')), compress: true },
		{ path: 'scene.json', data: encoder.encode(JSON.stringify(scene)), compress: true },
		...entries
	]);
	return { bytes, fileName: containerFileName(content.name, content.kind), assetCount: assets.length, missing };
}

export interface ParsedContainer {
	manifest: ContainerManifest;
	scene: SlotTree;
	/** The bytes of each asset in the file, checked against their content address. */
	assets: Map<AssetId, Uint8Array>;
}

function validateManifest(value: unknown): ContainerManifest {
	const m = value as Partial<ContainerManifest> | null;
	if (!m || typeof m !== 'object' || m.format !== CONTAINER_FORMAT) throw new ContainerError('not-a-container', 'This is not a Kithin file');
	if (m.version !== CONTAINER_VERSION) throw new ContainerError('unsupported-version', `This file needs a newer version of Kithin (format ${String(m.version)})`);
	if (!m.kind || !(m.kind in CONTAINER_KINDS)) throw new ContainerError('invalid-kind', 'This file holds something Kithin does not know how to open');
	if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120) throw new ContainerError('invalid-name', 'The file has no valid name');
	if (m.thumbnail !== undefined && !isAssetId(m.thumbnail)) throw new ContainerError('invalid-thumbnail', 'The file has an invalid preview');
	if (!Array.isArray(m.assets) || m.assets.length > CONTAINER_LIMITS.maxAssets) throw new ContainerError('invalid-assets', 'The file lists too many assets');
	const seen = new Set<string>();
	for (const asset of m.assets) {
		if (!asset || !isAssetId(asset.assetId) || seen.has(asset.assetId) || !asset.manifest || typeof asset.manifest.type !== 'string' || typeof asset.manifest.format !== 'string') throw new ContainerError('invalid-assets', 'The file lists an invalid asset');
		seen.add(asset.assetId);
	}
	return m as ContainerManifest;
}

/** Reads and checks a container file without touching any store. Throws `ContainerError` (or `ZipError`) saying what is wrong. */
export async function readContainer(bytes: Uint8Array): Promise<ParsedContainer> {
	if (bytes.byteLength > CONTAINER_LIMITS.maxBytes) throw new ContainerError('too-large', 'This file is too large');
	if (!looksLikeZip(bytes)) throw new ContainerError('not-a-container', 'This is not a Kithin file');
	const directory = readZipDirectory(bytes, { maxEntries: CONTAINER_LIMITS.maxAssets + 2, maxEntryBytes: 64 * 1024 * 1024, maxTotalBytes: CONTAINER_LIMITS.maxBytes });
	const find = (path: string) => directory.find((entry) => entry.path === path);
	const manifestEntry = find('kithin.json');
	const sceneEntry = find('scene.json');
	if (!manifestEntry || !sceneEntry) throw new ContainerError('not-a-container', 'This is not a Kithin file');
	if (manifestEntry.size > CONTAINER_LIMITS.maxManifestBytes || sceneEntry.size > CONTAINER_LIMITS.maxSceneBytes) throw new ContainerError('too-large', 'This file is too large');

	const decoder = new TextDecoder();
	let manifest: ContainerManifest;
	let scene: unknown;
	try {
		manifest = validateManifest(JSON.parse(decoder.decode(await readZipEntry(bytes, manifestEntry))));
		scene = JSON.parse(decoder.decode(await readZipEntry(bytes, sceneEntry)));
	} catch (error) {
		if (error instanceof SyntaxError) throw new ContainerError('corrupt', 'The file is damaged');
		throw error;
	}
	if (!Array.isArray(scene) || scene.length === 0 || scene.length > CONTAINER_LIMITS.maxSlots) throw new ContainerError('invalid-scene', 'The file has no valid scene');
	// A world is held to the same rules as one that is shared; objects and avatars are only checked for shape, as when they are saved.
	if (manifest.kind === 'world') {
		try {
			validateWorldScene(scene);
		} catch (error) {
			throw new ContainerError('invalid-scene', error instanceof Error ? error.message : 'The file has no valid scene');
		}
	}

	const listed = new Set(manifest.assets.map((asset) => asset.assetId));
	const assets = new Map<AssetId, Uint8Array>();
	for (const entry of directory) {
		const match = ASSET_PATH_PATTERN.exec(entry.path);
		if (!match) continue; // extra files (a readme someone added) are ignored, never trusted
		const id = `sha256:${match[1]}` as AssetId;
		if (!listed.has(id)) continue;
		const data = await readZipEntry(bytes, entry);
		if ((await assetIdOf(data)) !== id) throw new ContainerError('corrupt', `The asset ${id.slice(0, 15)}… does not match its content address`);
		assets.set(id, data);
	}
	return { manifest, scene: scene as SlotTree, assets };
}

export interface ImportOptions {
	onProgress?: (progress: { done: number; total: number; name: string }) => void;
}

export interface ImportedContainer {
	kind: ContainerKind;
	name: string;
	scene: SlotTree;
	thumbnail: AssetId | null;
	/** Assets written to the store. */
	added: number;
	/** Assets the store already had. */
	existing: number;
	/** Assets the scene uses that the file did not carry and the store does not have either. */
	missing: AssetId[];
}

/**
 * Reads a container and puts its assets into `store`. Each one goes through the same checks as a file the user imports by hand,
 * so a hand-made container cannot smuggle in anything the platform would not accept. The scene is returned, not saved: where it
 * lives (which library, which folder) is the caller's decision.
 */
export async function importContainer(bytes: Uint8Array, store: AssetStore, options: ImportOptions = {}): Promise<ImportedContainer> {
	const { manifest, scene, assets } = await readContainer(bytes);
	const hints = new Map(manifest.assets.map((asset) => [asset.assetId, asset.manifest]));
	let added = 0;
	let existing = 0;
	let done = 0;
	for (const [id, data] of assets) {
		const hint = hints.get(id)!;
		options.onProgress?.({ done: done++, total: assets.size, name: hint.name ?? 'Asset' });
		if (!getAssetKind(hint.type)) throw new ContainerError('unsupported-asset', `The file contains an asset of an unknown type (${hint.type})`);
		const extension = getAssetKind(hint.type) ? extensionOf(hint) : '';
		try {
			const result = await importAsset(data, `${typeof hint.name === 'string' ? hint.name : 'asset'}${extension}`, store, { type: hint.type });
			if (result.manifest.assetId !== id) throw new ContainerError('corrupt', 'An asset does not match its content address');
			if (result.alreadyStored) existing++;
			else added++;
		} catch (error) {
			if (error instanceof ContainerError) throw error;
			throw new ContainerError('invalid-asset', `${typeof hint.name === 'string' ? hint.name : 'An asset'}: ${error instanceof Error ? error.message : 'could not be imported'}`);
		}
	}
	const needed = await assetClosure(scene, [], store);
	const missing: AssetId[] = [];
	for (const id of needed) if (!(await store.has(id))) missing.push(id);
	const thumbnail = manifest.thumbnail && (await store.has(manifest.thumbnail)) ? manifest.thumbnail : null;
	return { kind: manifest.kind, name: manifest.name, scene, thumbnail, added, existing, missing };
}

export { ZipError };
