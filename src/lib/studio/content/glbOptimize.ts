/**
 * Makes a .glb lighter by re-encoding the pictures inside it as WebP (and scaling down the ones that are too big). The geometry and
 * everything else are copied byte for byte. The picture work is done by a function that is passed in, so the rules here (which
 * picture is for what, how the file is put back together) run in Node and are tested there.
 *
 * Pictures become WebP through `EXT_texture_webp`, which the engine already accepts; geometry compression (meshopt) is not done
 * because the engine does not load it (it would need a decoder shipped with it).
 */
export type TextureRole = 'albedo' | 'normal' | 'arm';

/** Re-encodes one picture, or answers null when it can not (so the original is kept). */
export type ImageConverter = (bytes: Uint8Array, role: TextureRole) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

export interface GlbOptimization {
	bytes: Uint8Array;
	/** Pictures found, and how many were replaced by a lighter one. */
	images: number;
	converted: number;
}

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** A picture is only replaced when the new one is at least this much smaller, so a file is not churned for nothing. */
const WORTH_IT = 0.95;

interface TextureInfo { index?: number }
interface Gltf {
	extensionsUsed?: string[];
	extensionsRequired?: string[];
	images?: { uri?: string; bufferView?: number; mimeType?: string }[];
	textures?: { source?: number; extensions?: Record<string, unknown> }[];
	bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
	buffers?: { byteLength: number; uri?: string }[];
	materials?: {
		pbrMetallicRoughness?: { baseColorTexture?: TextureInfo; metallicRoughnessTexture?: TextureInfo };
		normalTexture?: TextureInfo; occlusionTexture?: TextureInfo; emissiveTexture?: TextureInfo;
	}[];
}

const PRECEDENCE: Record<TextureRole, number> = { albedo: 0, arm: 1, normal: 2 };

/** What each picture is used for. One used for several things takes the most demanding role (a normal map keeps the most precision). */
export function imageRoles(gltf: Gltf): Map<number, TextureRole> {
	const roles = new Map<number, TextureRole>();
	const note = (info: TextureInfo | undefined, role: TextureRole) => {
		const image = info?.index === undefined ? undefined : gltf.textures?.[info.index]?.source;
		if (image === undefined) return;
		const current = roles.get(image);
		if (current === undefined || PRECEDENCE[role] > PRECEDENCE[current]) roles.set(image, role);
	};
	for (const material of gltf.materials ?? []) {
		note(material.pbrMetallicRoughness?.baseColorTexture, 'albedo');
		note(material.emissiveTexture, 'albedo');
		note(material.pbrMetallicRoughness?.metallicRoughnessTexture, 'arm');
		note(material.occlusionTexture, 'arm');
		note(material.normalTexture, 'normal');
	}
	return roles;
}

function readChunks(glb: Uint8Array): { json: Gltf; bin: Uint8Array } | null {
	if (glb.byteLength < 20) return null;
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== glb.byteLength) return null;
	let json: Gltf | null = null;
	let bin: Uint8Array | null = null;
	for (let offset = 12; offset + 8 <= glb.byteLength;) {
		const length = view.getUint32(offset, true);
		const type = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + length > glb.byteLength) return null;
		if (type === CHUNK_JSON && !json) {
			try { json = JSON.parse(new TextDecoder().decode(glb.subarray(start, start + length))) as Gltf; } catch { return null; }
		} else if (type === CHUNK_BIN && !bin) bin = glb.subarray(start, start + length);
		offset = start + ((length + 3) & ~3);
	}
	return json && bin ? { json, bin } : null;
}

function writeGlb(json: Gltf, bin: Uint8Array): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = (text.byteLength + 3) & ~3;
	const binLength = (bin.byteLength + 3) & ~3;
	const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.byteLength, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, CHUNK_JSON, true);
	out.fill(0x20, 20, 20 + jsonLength);
	out.set(text, 20);
	const binStart = 20 + jsonLength;
	view.setUint32(binStart, binLength, true);
	view.setUint32(binStart + 4, CHUNK_BIN, true);
	out.set(bin, binStart + 8);
	return out;
}

export async function optimizeGlb(glb: Uint8Array, convert: ImageConverter): Promise<GlbOptimization> {
	const unchanged = (images: number): GlbOptimization => ({ bytes: glb, images, converted: 0 });
	const parsed = readChunks(glb);
	const images = parsed?.json.images ?? [];
	if (!parsed || !images.length) return unchanged(images.length);
	const { json, bin } = parsed;
	const views = json.bufferViews ?? [];
	// Only the simple, self-contained case: every picture and view in the one binary chunk.
	if (views.some((view) => view.buffer !== 0) || images.some((image) => image.uri !== undefined)) return unchanged(images.length);

	const roles = imageRoles(json);
	const replacement = new Map<number, Uint8Array>();
	await Promise.all(images.map(async (image, index) => {
		const mime = image.mimeType;
		if (image.bufferView === undefined || (mime !== 'image/png' && mime !== 'image/jpeg')) return;
		const view = views[image.bufferView];
		if (!view) return;
		const start = view.byteOffset ?? 0;
		if (start + view.byteLength > bin.byteLength) return;
		const original = bin.subarray(start, start + view.byteLength);
		let converted;
		try { converted = await convert(original, roles.get(index) ?? 'albedo'); } catch { return; }
		if (converted && converted.mimeType === 'image/webp' && converted.bytes.byteLength < original.byteLength * WORTH_IT) replacement.set(index, converted.bytes);
	}));
	if (!replacement.size) return unchanged(images.length);

	// Put the binary chunk back together, each view on a 4-byte boundary, with the new pictures in place of the old.
	const swapped = new Map<number, Uint8Array>();
	for (const [imageIndex, bytes] of replacement) swapped.set(images[imageIndex].bufferView!, bytes);
	const pieces: Uint8Array[] = [];
	let cursor = 0;
	const nextViews = views.map((view, index) => {
		const data = swapped.get(index) ?? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
		const placed = { ...view, byteOffset: cursor, byteLength: data.byteLength };
		pieces.push(data);
		const padded = (data.byteLength + 3) & ~3;
		if (padded > data.byteLength) pieces.push(new Uint8Array(padded - data.byteLength));
		cursor += padded;
		return placed;
	});
	const rebuilt = new Uint8Array(cursor);
	let at = 0;
	for (const piece of pieces) { rebuilt.set(piece, at); at += piece.byteLength; }

	const next: Gltf = { ...json, bufferViews: nextViews, buffers: [{ ...(json.buffers?.[0] ?? { byteLength: 0 }), byteLength: rebuilt.byteLength }] };
	next.images = images.map((image, index) => (replacement.has(index) ? { ...image, mimeType: 'image/webp' } : image));
	next.textures = (json.textures ?? []).map((texture) => (texture.source !== undefined && replacement.has(texture.source) ? { ...texture, extensions: { ...texture.extensions, EXT_texture_webp: { source: texture.source } } } : texture));
	next.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
	next.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
	return { bytes: writeGlb(next, rebuilt), images: images.length, converted: replacement.size };
}
