import { ASSET_LIMITS } from '@kithin/engine/assets/limits';
import { loadPolyHavenLogic } from '$lib/content/templates/polyHeavenMaterials';
import { isTextureId } from './polyHavenTextures';

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'Kithin-WebXR/0.1';
const MAX_GLTF_BYTES = 1_000_000;
const MAX_MODEL_BYTES = ASSET_LIMITS.maxBytes;
const CACHE_MS = 5 * 60_000;

interface ApiModel {
	name?: string;
	description?: string;
	category?: string;
	tags?: string[];
	thumbnail_url?: string;
	polycount?: number;
	type?: number;
}
interface ApiFile { url: string; size: number }
interface GltfFile extends ApiFile { include?: Record<string, ApiFile> }
interface GltfDocument {
	asset?: { version?: string };
	buffers?: Array<{ uri?: string; byteLength: number }>;
	bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number }>;
	images?: Array<{ uri?: string; bufferView?: number; mimeType?: string }>;
	materials?: Array<{ alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }>;
	[key: string]: unknown;
}

/** How much of the scene a glass surface hides: a faint tint, since the picture it takes its colour from has no transparency to give. */
export const GLASS_OPACITY = 0.1;

/**
 * Poly Haven's glass is a blended material that reads its colour from the model's one picture, a JPEG, which cannot hold
 * transparency: the glass comes out as an opaque patch of whatever it points at (black, for a clock's face). Its opacity is set
 * here instead, so what is behind it can be seen.
 */
export function seeThroughGlass(gltf: GltfDocument): void {
	for (const material of gltf.materials ?? []) {
		if (material.alphaMode !== 'BLEND') continue;
		const pbr = (material.pbrMetallicRoughness ??= {});
		const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
		if ((factor[3] ?? 1) >= 1) pbr.baseColorFactor = [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1, GLASS_OPACITY];
	}
}

let modelCache: { until: number; models: Record<string, ApiModel> } | null = null;

function bad(message: string, status = 400): never {
	throw Object.assign(new Error(message), { status });
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
	if (!response.ok) bad(`Poly Haven returned HTTP ${response.status}`, 502);
	if (Number(response.headers.get('content-length') ?? 0) > limit) bad('This model exceeds the 25 MB import limit.', 413);
	if (!response.body) bad('Poly Haven returned an empty file.', 502);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			bad('This model exceeds the 25 MB import limit.', 413);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

async function apiJson<T>(path: string): Promise<T> {
	const response = await fetch(`${API}${path}`, {
		headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});
	return JSON.parse(new TextDecoder().decode(await readLimited(response, 4_000_000))) as T;
}

async function allModels(): Promise<Record<string, ApiModel>> {
	if (modelCache && modelCache.until > Date.now()) return modelCache.models;
	const models = await apiJson<Record<string, ApiModel>>('/assets?type=models');
	modelCache = { until: Date.now() + CACHE_MS, models };
	return models;
}

export async function searchPolyHaven(query: string, page: number, size = 5) {
	const words = query.toLowerCase().trim().slice(0, 80).split(/\s+/).filter(Boolean);
	const models = await allModels();
	const matches = Object.entries(models)
		.filter(([, model]) => model.type === 2 && (model.polycount ?? 0) <= ASSET_LIMITS.maxTriangles)
		.filter(([, model]) => {
			const haystack = `${model.name ?? ''} ${model.description ?? ''} ${model.category ?? ''} ${(model.tags ?? []).join(' ')}`.toLowerCase();
			return words.every((word) => haystack.includes(word));
		})
		.sort((a, b) => a[1].name?.localeCompare(b[1].name ?? '') ?? 0);
	const offset = Math.max(0, Math.min(page, 1000)) * size;
	return {
		total: matches.length,
		page: Math.floor(offset / size),
		results: matches.slice(offset, offset + size).map(([id, model]) => ({
			id,
			name: model.name ?? id,
			thumbnail: model.thumbnail_url ?? '',
			category: model.category ?? '',
			tags: model.tags ?? [],
			polycount: model.polycount ?? 0
		}))
	};
}

function checkedCdnUrl(value: unknown): string {
	if (typeof value !== 'string') bad('Invalid Poly Haven file URL.', 502);
	const url = new URL(value);
	if (url.protocol !== 'https:' || url.hostname !== 'dl.polyhaven.org' || !url.pathname.startsWith('/file/ph-assets/Models/')) {
		bad('Unexpected Poly Haven file host.', 502);
	}
	return url.href;
}

async function download(file: ApiFile, limit: number): Promise<Uint8Array> {
	if (!file || !Number.isFinite(file.size) || file.size < 0 || file.size > limit) bad('This model exceeds the 25 MB import limit.', 413);
	const response = await fetch(checkedCdnUrl(file.url), {
		headers: { 'user-agent': USER_AGENT },
		signal: AbortSignal.timeout(30_000),
		redirect: 'error'
	});
	return readLimited(response, limit);
}

function mimeType(uri: string): string {
	const path = uri.toLowerCase();
	if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
	if (path.endsWith('.png')) return 'image/png';
	if (path.endsWith('.webp')) return 'image/webp';
	return bad('This model uses an unsupported image format.', 422);
}

/** Pack Poly Haven's glTF, geometry and textures into the self-contained GLB accepted by Kithin. */
export async function polyHavenGlb(id: string): Promise<Uint8Array> {
	if (!/^[A-Za-z0-9_]{1,90}$/.test(id)) bad('Invalid model ID.');
	const model = (await allModels())[id];
	if (!model || model.type !== 2) bad('Model not found.', 404);
	if ((model.polycount ?? 0) > ASSET_LIMITS.maxTriangles) bad('This model has too many polygons for Kithin.', 422);
	const files = await apiJson<Record<string, unknown>>(`/files/${id}`);
	const variants = files.gltf as Record<string, { gltf?: GltfFile }> | undefined;
	const selected = variants?.['1k']?.gltf ?? variants?.['2k']?.gltf;
	if (!selected) bad('This model has no suitable glTF version.', 422);
	const includes = selected.include ?? {};
	const listedSize = selected.size + Object.values(includes).reduce((sum, file) => sum + file.size, 0);
	if (!Number.isFinite(listedSize) || listedSize > MAX_MODEL_BYTES - 1_000_000) bad('This model exceeds the 25 MB import limit.', 413);
	const gltfBytes = await download(selected, MAX_GLTF_BYTES);
	let gltf: GltfDocument;
	try { gltf = JSON.parse(new TextDecoder().decode(gltfBytes)) as GltfDocument; }
	catch { bad('Poly Haven returned invalid glTF.', 502); }
	if (gltf.asset?.version !== '2.0') bad('Only glTF 2.0 models can be imported.', 422);
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const append = (bytes: Uint8Array): number => {
		const start = byteLength;
		chunks.push(bytes);
		byteLength += (bytes.byteLength + 3) & ~3;
		if (byteLength > MAX_MODEL_BYTES - 1_000_000) bad('This model exceeds the 25 MB import limit.', 413);
		return start;
	};
	const originalBuffers = gltf.buffers ?? [];
	const offsets: number[] = [];
	for (const buffer of originalBuffers) {
		if (!buffer.uri || !includes[buffer.uri]) bad('This model has an unavailable geometry file.', 422);
		const bytes = await download(includes[buffer.uri], MAX_MODEL_BYTES - byteLength);
		if (bytes.byteLength < buffer.byteLength) bad('Poly Haven returned incomplete geometry.', 502);
		offsets.push(append(bytes));
	}
	for (const view of gltf.bufferViews ?? []) {
		if (!Number.isInteger(view.buffer) || offsets[view.buffer] === undefined) bad('Invalid glTF buffer view.', 502);
		view.byteOffset = offsets[view.buffer] + (view.byteOffset ?? 0);
		view.buffer = 0;
	}
	gltf.bufferViews ??= [];
	for (const image of gltf.images ?? []) {
		if (!image.uri || image.uri.startsWith('data:')) continue;
		const file = includes[image.uri];
		if (!file) bad('This model has an unavailable texture.', 422);
		const bytes = await download(file, MAX_MODEL_BYTES - byteLength);
		image.bufferView = gltf.bufferViews.length;
		image.mimeType = mimeType(image.uri);
		gltf.bufferViews.push({ buffer: 0, byteOffset: append(bytes), byteLength: bytes.byteLength });
		delete image.uri;
	}
	seeThroughGlass(gltf);
	gltf.buffers = [{ byteLength }];
	const encoded = Buffer.from(JSON.stringify(gltf));
	const jsonLength = (encoded.byteLength + 3) & ~3;
	const total = 12 + 8 + jsonLength + 8 + byteLength;
	if (total > MAX_MODEL_BYTES) bad('This model exceeds the 25 MB import limit.', 413);
	const glb = Buffer.alloc(total);
	glb.writeUInt32LE(0x46546c67, 0);
	glb.writeUInt32LE(2, 4);
	glb.writeUInt32LE(total, 8);
	glb.writeUInt32LE(jsonLength, 12);
	glb.writeUInt32LE(0x4e4f534a, 16);
	glb.fill(0x20, 20, 20 + jsonLength);
	encoded.copy(glb, 20);
	const binHeader = 20 + jsonLength;
	glb.writeUInt32LE(byteLength, binHeader);
	glb.writeUInt32LE(0x004e4942, binHeader + 4);
	let cursor = binHeader + 8;
	for (const chunk of chunks) {
		glb.set(chunk, cursor);
		cursor += (chunk.byteLength + 3) & ~3;
	}
	return glb;
}

// --- textures --------------------------------------------------------------

let textureCache: { until: number; assets: Record<string, unknown> } | null = null;

async function allTextures(): Promise<Record<string, unknown>> {
	if (textureCache && textureCache.until > Date.now()) return textureCache.assets;
	const assets = await apiJson<Record<string, unknown>>(loadPolyHavenLogic().assetsUrl().replace(API, ''));
	textureCache = { until: Date.now() + CACHE_MS, assets };
	return assets;
}

/** Textures matching a search, best match first, in pages of eight. The rules for reading the library are the ones of the in-world material shop. */
export async function searchPolyHavenTextures(query: string, page: number, size = 8) {
	const logic = loadPolyHavenLogic();
	const text = query.trim().slice(0, 80);
	const assets = await allTextures();
	const details = new Map(logic.parseAssets(assets).map((texture) => [texture.id, texture]));
	let ids: string[];
	if (text) ids = logic.parseSearch(await apiJson<unknown>(logic.searchUrl(text).replace(API, ''))).filter((id) => details.has(id));
	else ids = [...details.keys()];
	const offset = Math.max(0, Math.min(page, 1000)) * size;
	return {
		total: ids.length,
		page: Math.floor(offset / size),
		results: ids.slice(offset, offset + size).map((id) => {
			const texture = details.get(id)!;
			return { id, name: texture.name, category: texture.category, size: texture.size, thumbnail: texture.thumb };
		})
	};
}

/** A model's listing entry, or null when the id is not a model. */
export async function polyHavenModelInfo(id: string) {
	if (!isTextureId(id)) bad('Invalid model ID.');
	const model = (await allModels())[id];
	if (!model || model.type !== 2) return null;
	return { id, name: model.name ?? id, description: model.description ?? '', category: model.category ?? '', tags: model.tags ?? [], thumbnail: model.thumbnail_url ?? '', polycount: model.polycount ?? 0 };
}

/** A texture's listing entry and its raw file list (every size and format), or null when the id is not a texture. */
export async function polyHavenTextureFiles(id: string) {
	if (!isTextureId(id)) bad('Invalid texture ID.');
	const texture = loadPolyHavenLogic().parseAssets(await allTextures()).find((entry) => entry.id === id);
	if (!texture) return null;
	return { id, name: texture.name, category: texture.category, size: texture.size, thumbnail: texture.thumb, files: await apiJson<unknown>(`/files/${id}`) };
}
