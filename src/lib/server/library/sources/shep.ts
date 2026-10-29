import { readZipDirectory, readZipEntry } from '@kithin/engine/container/zip';
import { UNKNOWN_LICENSE } from '@kithin/engine/library/license';
import { formatAssetRef } from '@kithin/engine/library/ref';
import type { AssetDetail, AssetKind, AssetSource, AssetSummary, FileRole, License, RemoteFile, SearchPage, SearchQuery, Variant } from '@kithin/engine/library/types';
import { ANY_PUBLIC_HOST, cachedLoader, createJsonClient, fetchLimited, LibraryError, TtlCache } from '../http';

/**
 * shep's 3D Asset Server (https://3d.shep.bot): one API over many libraries (Poly Haven, ambientCG, BlenderKit, Kenney…). Its ids are
 * `provider:nativeId`, which is also how this source names things (`shep:ambientcg:Bricks097`).
 *
 * It is an aggregator, so what it gives has to be made to fit: ambientCG sends a material as one ZIP of maps, which `open` unpacks
 * here so the importer gets the maps one by one; only GLB models can be imported (the rest are listed, marked as needing conversion);
 * the files come from each provider's own domain (`grab3d.com`, `opengameart.org`, `upload.wikimedia.org`…), so any named public host is
 * accepted by default, checked for DNS that points inside our network. `extraHosts` / `SHEP_CDN_HOSTS` turns that into a fixed list.
 */
export interface ShepOptions {
	baseUrl?: string;
	apiKey?: string;
	/** When given, its files may only come from these hosts (and shep's own) instead of any public host (`SHEP_CDN_HOSTS`). */
	extraHosts?: string[];
	/** Providers not to ask for, because a source of ours serves them directly (Poly Haven). */
	exclude?: string[];
}

const ZIP_SCHEME = 'shepzip:';
const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAP_BYTES = 8 * 1024 * 1024;

const SHEP_TYPES: Record<AssetKind, string> = { model: 'model', material: 'material', texture: 'texture', hdri: 'hdri', audio: 'audio', image: 'sprite,ui', font: 'font', pack: 'pack' };
const KIND_OF: Record<string, AssetKind | undefined> = { model: 'model', material: 'material', texture: 'texture', hdri: 'hdri', audio: 'audio', sprite: 'image', ui: 'image', font: 'font', pack: 'pack' };

/** The formats of an asset that an importer here can use, by kind. An asset that says nothing about its formats (Kenney's packs are ZIPs) is not importable. */
const IMPORTABLE_FORMATS: Partial<Record<AssetKind, string[]>> = { model: ['glb'], material: ['jpg', 'png'], audio: ['mp3', 'wav', 'ogg'], image: ['png', 'webp'] };
export function isImportable(kind: AssetKind, formats: readonly string[] | undefined): boolean {
	const wanted = IMPORTABLE_FORMATS[kind];
	return Boolean(wanted && formats?.some((format) => wanted.includes(format.toLowerCase())));
}

interface ShepLicense { name?: string; url?: string; commercialUse?: boolean; attributionRequired?: boolean }
interface ShepFile { url: string; filename?: string; format: string; resolution?: string; mapType?: string; sizeBytes?: number; group?: string; requiresAuth?: boolean; includes?: { path: string; url: string; sizeBytes?: number }[] }
interface ShepAsset {
	formats?: string[];
	id: string; provider: string; title: string; type: string; url: string; thumbnailUrl?: string; author?: string; description?: string;
	license?: ShepLicense; tags?: string[]; categories?: string[]; downloadable?: boolean; polyCount?: number; animated?: boolean; rigged?: boolean; resolutions?: string[];
	files?: ShepFile[];
}
interface ShepProvider { id: string; assetTypes: string[]; enabled?: boolean; access?: string }

const tristate = (value: unknown): boolean | 'unknown' => (value === true || value === false ? value : 'unknown');
const license = (value: ShepLicense | undefined): License => (value?.name ? { name: value.name, ...(value.url ? { url: value.url } : {}), commercialUse: tristate(value.commercialUse), attributionRequired: tristate(value.attributionRequired) } : UNKNOWN_LICENSE);
const https = (value: unknown): string | undefined => (typeof value === 'string' && value.startsWith('https://') ? value : undefined);

/** What a map is called in a provider's file list, as a role. */
function mapRole(mapType: string | undefined): FileRole | null {
	const name = (mapType ?? '').toLowerCase().replace(/[^a-z]/g, '');
	if (['diffuse', 'diff', 'albedo', 'color', 'basecolor'].includes(name)) return 'albedo';
	if (['norgl', 'normal', 'normalgl', 'nor'].includes(name)) return 'normal';
	if (['rough', 'roughness'].includes(name)) return 'roughness';
	if (['ao', 'ambientocclusion', 'occlusion'].includes(name)) return 'ao';
	if (['metal', 'metallic', 'metalness'].includes(name)) return 'metallic';
	if (name === 'arm') return 'arm';
	return null;
}

/** The entries of an ambientCG ZIP that stand for each role. */
const ZIP_ROLES: [FileRole, RegExp][] = [
	['albedo', /_Color\.(jpg|png)$/i], ['normal', /_NormalGL\.(jpg|png)$/i], ['roughness', /_Roughness\.(jpg|png)$/i], ['ao', /_AmbientOcclusion\.(jpg|png)$/i], ['metallic', /_Metalness\.(jpg|png)$/i]
];

const variantId = (parts: (string | undefined)[]) => parts.filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'default';

function modelVariants(files: ShepFile[]): Variant[] {
	const variants: Variant[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		const format = file.format.toLowerCase();
		if (file.requiresAuth) continue;
		if (format === 'glb') {
			variants.push({ id: variantId(['glb', file.group, String(variants.length)]), label: `GLB${file.group ? ` · ${file.group}` : ''}`, format: 'glb', ...(file.sizeBytes ? { totalBytes: file.sizeBytes } : {}), files: [{ role: 'model', url: file.url, format: 'glb', sizeBytes: file.sizeBytes }] });
		} else if (['gltf', 'fbx', 'obj', 'blend', 'usd', 'usdz', 'dae', '3ds'].includes(format) && !seen.has(format) && file.group !== 'resolutions') {
			// One line per format, so a person sees what else exists and why it can not be imported.
			seen.add(format);
			variants.push({
				id: variantId([format]), label: format.toUpperCase(), format,
				files: [{ role: 'model', url: file.url, format, sizeBytes: file.sizeBytes, ...(file.includes?.length ? { includes: file.includes } : {}) }],
				unsupported: format === 'gltf' ? 'This glTF comes as several files; only GLB can be imported for now.' : `${format.toUpperCase()} needs converting to GLB first.`
			});
		}
	}
	return variants.sort((a, b) => Number(Boolean(a.unsupported)) - Number(Boolean(b.unsupported)));
}

function materialVariants(files: ShepFile[]): Variant[] {
	const variants = new Map<string, Variant>();
	const add = (resolution: string, variant: () => Variant) => { if (!variants.has(resolution)) variants.set(resolution, variant()); return variants.get(resolution)!; };
	// ambientCG style: one ZIP per size and format, unpacked on request.
	for (const file of files.filter((candidate) => candidate.format.toLowerCase() === 'zip' && candidate.resolution && !candidate.requiresAuth)) {
		const resolution = file.resolution!;
		if (variants.has(resolution) && file.group !== 'jpg') continue;
		const roles: FileRole[] = ['albedo', 'normal', 'roughness', 'ao', 'metallic'];
		variants.set(resolution, {
			id: resolution, label: resolution.toUpperCase(), resolution, format: file.group ?? 'jpg', ...(file.sizeBytes ? { totalBytes: file.sizeBytes } : {}),
			files: roles.map((role) => ({ role, url: `${ZIP_SCHEME}${encodeURIComponent(file.url)}#${role}`, format: file.group === 'png' ? 'png' : 'jpg' }))
		});
	}
	// Poly Haven style: each map is a file of its own.
	for (const file of files) {
		const role = mapRole(file.mapType);
		const format = file.format.toLowerCase();
		if (!role || !file.resolution || file.requiresAuth || !['jpg', 'png'].includes(format) || (file.sizeBytes ?? 0) > MAP_BYTES) continue;
		const variant = add(file.resolution, () => ({ id: file.resolution!, label: file.resolution!.toUpperCase(), resolution: file.resolution, format: 'jpg', files: [] }));
		if (variant.files.some((existing) => existing.role === role) || variant.files.some((existing) => existing.url.startsWith(ZIP_SCHEME))) continue;
		variant.files.push({ role, url: file.url, format, ...(file.sizeBytes ? { sizeBytes: file.sizeBytes } : {}) });
	}
	return [...variants.values()].filter((variant) => variant.files.some((file) => file.role === 'albedo' || file.role === 'normal')).sort((a, b) => parseInt(a.resolution ?? '0') - parseInt(b.resolution ?? '0'));
}

function simpleVariants(files: ShepFile[], role: FileRole, supported: string[], reason: string): Variant[] {
	const variants: Variant[] = [];
	for (const file of files.filter((candidate) => !candidate.requiresAuth).slice(0, 12)) {
		const format = file.format.toLowerCase();
		if (['zip', 'blend', 'exr', 'hdr'].includes(format) && role !== 'other') continue;
		const ok = supported.includes(format);
		variants.push({ id: variantId([format, String(variants.length)]), label: format.toUpperCase(), format, ...(file.sizeBytes ? { totalBytes: file.sizeBytes } : {}), files: [{ role, url: file.url, format, sizeBytes: file.sizeBytes }], ...(ok ? {} : { unsupported: reason }) });
	}
	return variants.sort((a, b) => Number(Boolean(a.unsupported)) - Number(Boolean(b.unsupported)));
}

function variantsFor(kind: AssetKind, files: ShepFile[]): Variant[] {
	if (kind === 'model') return modelVariants(files);
	if (kind === 'material') return materialVariants(files);
	if (kind === 'audio') return simpleVariants(files, 'audio', ['mp3', 'wav', 'ogg'], 'Only MP3, WAV and OGG can be imported.');
	if (kind === 'image') return simpleVariants(files, 'image', ['png', 'webp'], 'Only PNG and WebP can be imported.');
	return simpleVariants(files, 'other', [], `Importing ${kind} is not available yet.`);
}

export function createShepSource(options: ShepOptions = {}): AssetSource {
	const baseUrl = options.baseUrl?.trim() || 'https://3d.shep.bot';
	const host = new URL(baseUrl).hostname;
	const allowedHosts = options.extraHosts?.length ? [host, ...options.extraHosts] : [host, ANY_PUBLIC_HOST];
	const headers = options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined;
	const getJson = createJsonClient({ base: baseUrl, name: 'shep', headers, requestsPerMinute: 100 });
	const zips = cachedLoader(new TtlCache<Uint8Array>(2 * 60_000, 3));
	const exclude = new Set(options.exclude ?? []);

	const summary = (asset: ShepAsset): AssetSummary | null => {
		const kind = KIND_OF[asset.type];
		const sourceUrl = https(asset.url);
		if (!kind || !sourceUrl || !asset.id || !asset.title) return null;
		const thumbnail = https(asset.thumbnailUrl);
		return {
			ref: formatAssetRef('shep', asset.id), kind, title: asset.title, ...(thumbnail ? { thumbnailUrl: thumbnail } : {}), ...(asset.author ? { author: asset.author } : {}),
			license: license(asset.license), tags: asset.tags ?? [], ...(asset.categories?.length ? { categories: asset.categories } : {}), sourceUrl, downloadable: asset.downloadable === true && isImportable(kind, asset.formats),
			facts: { ...(asset.polyCount ? { polyCount: asset.polyCount } : {}), ...(asset.animated !== undefined ? { animated: asset.animated } : {}), ...(asset.rigged !== undefined ? { rigged: asset.rigged } : {}), ...(asset.resolutions?.length ? { resolutions: asset.resolutions } : {}) }
		};
	};

	return {
		info: {
			id: 'shep', name: '3D Asset Server', homepage: 'https://3d.shep.bot', // No 'audio': what it lists is ZIP packs (Kenney, itch.io) with no importable file, so Sounds would offer it and always come back empty.
			kinds: ['model', 'material', 'texture', 'hdri', 'image', 'font', 'pack'],
			access: 'api', allowedHosts, ...(options.apiKey ? { needsKey: true } : {}), covers: ['polyhaven', 'ambientcg', 'blenderkit', 'kenney', 'polyfork', 'wikimediacommons', 'scenario', 'opengameart', 'texturecan', 'hdrmaps', 'grab3d', 'threedassets'].filter((id) => exclude.has(id))
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage> {
			const limit = Math.max(1, Math.min(query.limit ?? 24, 100));
			const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
			const params = new URLSearchParams({ q: query.text, type: SHEP_TYPES[query.kind], downloadable: 'true', limit: String(limit), offset: String(offset) });
			if (query.filters?.freeOnly) params.set('free', 'true');
			if (exclude.size) {
				// Ask only the providers that nothing of ours serves directly, so the same asset is not listed twice.
				const { providers } = await getJson<{ providers: ShepProvider[] }>('/v1/providers', signal);
				const wanted = SHEP_TYPES[query.kind].split(',');
				const ids = providers.filter((provider) => provider.enabled !== false && !exclude.has(provider.id) && provider.assetTypes.some((type) => wanted.includes(type))).map((provider) => provider.id);
				if (!ids.length) return { items: [], next: null, total: 0 };
				params.set('providers', ids.join(','));
			}
			const answer = await getJson<{ results: ShepAsset[]; providers?: { total?: number }[] }>(`/v1/search?${params}`, signal);
			const all = answer.results.slice(0, limit).map(summary).filter((item): item is AssetSummary => item !== null && item.kind === query.kind);
			// What can not be imported here is left out unless asked for, so every card in the list can be used.
			const items = query.filters?.importableOnly === false ? all : all.filter((item) => item.downloadable);
			const totals = (answer.providers ?? []).map((provider) => provider.total).filter((total): total is number => typeof total === 'number');
			const reached = offset + limit;
			return { items, next: totals.length ? (reached < Math.max(...totals) ? String(reached) : null) : (answer.results.length >= limit ? String(reached) : null), ...(totals.length && items.length === all.length ? { total: totals.reduce((sum, total) => sum + total, 0) } : {}) };
		},

		async detail(nativeId: string, signal?: AbortSignal): Promise<AssetDetail> {
			const asset = await getJson<ShepAsset>(`/v1/assets/${encodeURIComponent(nativeId)}`, signal);
			const found = summary(asset);
			if (!found) throw new LibraryError(502, 'The source returned an asset this app can not read.');
			const variants = variantsFor(found.kind, asset.files ?? []);
			return { ...found, ...(asset.description ? { description: asset.description } : {}), downloadable: found.downloadable && variants.some((variant) => !variant.unsupported), variants };
		},

		async open(file: RemoteFile, signal?: AbortSignal) {
			if (!file.url.startsWith(ZIP_SCHEME)) return null;
			const [encoded, role] = file.url.slice(ZIP_SCHEME.length).split('#');
			const zipUrl = decodeURIComponent(encoded);
			const bytes = await zips(zipUrl, async () => (await fetchLimited(zipUrl, { allowedHosts, maxBytes: MAX_ZIP_BYTES, timeoutMs: 60_000, signal })).bytes);
			let directory;
			try { directory = readZipDirectory(bytes); } catch { throw new LibraryError(502, 'The source sent a damaged archive.'); }
			const pattern = ZIP_ROLES.find(([name]) => name === role)?.[1];
			const entry = pattern ? directory.find((candidate) => pattern.test(candidate.path)) : undefined;
			if (!entry) throw new LibraryError(404, 'That map is not in the archive.');
			if (entry.size > MAP_BYTES) throw new LibraryError(413, 'This map is too large to import.');
			return { bytes: await readZipEntry(bytes, entry), contentType: entry.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' };
		}
	};
}
