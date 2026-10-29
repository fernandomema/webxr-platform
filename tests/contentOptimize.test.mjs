import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { optimizeGlb, imageRoles } = await import('../src/lib/studio/content/glbOptimize.ts');
const { planAudio, sideRatio, encodeWav16 } = await import('../src/lib/studio/content/audioOptimize.ts');
const { parseGlb } = await import('../packages/engine/src/assets/glb.ts');

/** A tiny .glb with a triangle and embedded pictures: [{ bytes, mimeType }]. */
function glbWithImages(pictures, material = {}) {
	const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const indices = new Uint16Array([0, 1, 2, 0]);
	const parts = [new Uint8Array(positions.buffer), new Uint8Array(indices.buffer), ...pictures.map((picture) => picture.bytes)];
	const views = []; let offset = 0;
	for (const part of parts) { views.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength }); offset += (part.byteLength + 3) & ~3; }
	const bin = new Uint8Array(offset);
	parts.forEach((part, i) => bin.set(part, views[i].byteOffset));
	views[1].byteLength = 6;
	const json = {
		asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
		accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }],
		bufferViews: views, buffers: [{ byteLength: bin.byteLength }],
		images: pictures.map((picture, i) => ({ bufferView: 2 + i, mimeType: picture.mimeType })),
		textures: pictures.map((_, i) => ({ source: i })),
		materials: [material]
	};
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = (text.byteLength + 3) & ~3;
	const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.byteLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.byteLength, true);
	view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jsonLength); out.set(text, 20);
	const start = 20 + jsonLength;
	view.setUint32(start, bin.byteLength, true); view.setUint32(start + 4, 0x004e4942, true); out.set(bin, start + 8);
	return out;
}

function readBack(glb) {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
	const binStart = 20 + jsonLength + 8;
	return { json, bin: glb.subarray(binStart, binStart + view.getUint32(20 + jsonLength, true)) };
}

const png = (size, fill) => ({ bytes: new Uint8Array(size).fill(fill), mimeType: 'image/png' });
const smaller = (factor) => async (bytes) => ({ bytes: new Uint8Array(Math.ceil(bytes.byteLength * factor)).fill(9), mimeType: 'image/webp' });

test('the pictures inside a model are replaced by lighter WebP ones and the rest of the file is untouched', async () => {
	const original = glbWithImages([png(4000, 1), png(2501, 2)]);
	const result = await optimizeGlb(original, smaller(0.25));
	assert.equal(result.converted, 2);
	assert.ok(result.bytes.byteLength < original.byteLength / 2);
	const { json, bin } = readBack(result.bytes);
	assert.deepEqual(json.images.map((image) => image.mimeType), ['image/webp', 'image/webp']);
	assert.deepEqual(json.textures.map((texture) => texture.extensions.EXT_texture_webp.source), [0, 1]);
	assert.ok(json.extensionsUsed.includes('EXT_texture_webp') && json.extensionsRequired.includes('EXT_texture_webp'));
	assert.equal(json.buffers[0].byteLength, bin.byteLength);
	// The geometry is exactly what it was.
	const positions = new Float32Array(bin.slice(json.bufferViews[0].byteOffset, json.bufferViews[0].byteOffset + 36).buffer);
	assert.deepEqual([...positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
	assert.deepEqual([...new Uint16Array(bin.slice(json.bufferViews[1].byteOffset, json.bufferViews[1].byteOffset + 6).buffer)], [0, 1, 2]);
	// Every view starts on a 4-byte boundary and the pictures hold the new bytes.
	assert.ok(json.bufferViews.every((view) => view.byteOffset % 4 === 0));
	assert.ok(bin.subarray(json.bufferViews[2].byteOffset, json.bufferViews[2].byteOffset + json.bufferViews[2].byteLength).every((byte) => byte === 9));
});

test('the engine accepts what comes out', async () => {
	const result = await optimizeGlb(glbWithImages([png(4000, 1)]), smaller(0.3));
	const stats = parseGlb(result.bytes);
	assert.equal(stats.triangles, 1);
	assert.equal(stats.textures, 1);
});

test('a picture that does not get lighter, or can not be converted, stays as it was', async () => {
	const original = glbWithImages([png(4000, 1), png(3000, 2)]);
	const mixed = await optimizeGlb(original, async (bytes) => (bytes.byteLength === 4000 ? { bytes: new Uint8Array(3900), mimeType: 'image/webp' } : null));
	assert.equal(mixed.converted, 0, '97% is not worth it, and null means it could not');
	assert.equal(mixed.bytes, original, 'the very same bytes come back when nothing changed');
	const throwing = await optimizeGlb(original, async () => { throw new Error('no canvas'); });
	assert.equal(throwing.converted, 0);
	const some = await optimizeGlb(original, async (bytes) => (bytes.byteLength === 4000 ? { bytes: new Uint8Array(500), mimeType: 'image/webp' } : null));
	assert.equal(some.converted, 1);
	assert.deepEqual(readBack(some.bytes).json.images.map((image) => image.mimeType), ['image/webp', 'image/png']);
});

test('a model without pictures, or already in WebP, or not a GLB, is returned unchanged', async () => {
	const none = glbWithImages([]);
	assert.equal((await optimizeGlb(none, smaller(0.1))).bytes, none);
	const webp = glbWithImages([{ bytes: new Uint8Array(2000), mimeType: 'image/webp' }]);
	assert.equal((await optimizeGlb(webp, smaller(0.1))).converted, 0);
	const junk = new Uint8Array([1, 2, 3, 4, 5]);
	assert.equal((await optimizeGlb(junk, smaller(0.1))).bytes, junk);
});

test('each picture is converted as what it is for, and a normal map keeps the most precision', async () => {
	const material = { pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2 }, occlusionTexture: { index: 1 } };
	const seen = [];
	await optimizeGlb(glbWithImages([png(4000, 1), png(4000, 2), png(4000, 3)], material), async (bytes, role) => { seen.push([bytes[0], role]); return null; });
	assert.deepEqual(seen.sort(), [[1, 'albedo'], [2, 'arm'], [3, 'normal']]);
	assert.equal(imageRoles({ textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 0 } }] }).get(0), 'normal');
});

test('audio: nothing above 44.1 kHz, one channel when both are the same, otherwise stereo', () => {
	assert.deepEqual(planAudio({ channels: 2, sampleRate: 96000, sideRatio: 0 }), { channels: 1, sampleRate: 44100 });
	assert.deepEqual(planAudio({ channels: 2, sampleRate: 48000, sideRatio: 0.3 }), { channels: 2, sampleRate: 44100 });
	assert.deepEqual(planAudio({ channels: 1, sampleRate: 22050, sideRatio: 0 }), { channels: 1, sampleRate: 22050 });
	assert.deepEqual(planAudio({ channels: 6, sampleRate: 44100, sideRatio: 0.2 }), { channels: 2, sampleRate: 44100 });
	const a = new Float32Array([0.1, -0.4, 0.9]);
	assert.equal(sideRatio(a, a), 0);
	assert.ok(sideRatio(a, a.map((x) => -x)) === Infinity);
	assert.ok(sideRatio(a, new Float32Array([0.1, -0.4, 0.8])) > 0);
});

test('a WAV is written with the right header and 16-bit samples', () => {
	const wav = encodeWav16([new Float32Array([0, 1, -1, 0.5]), new Float32Array([0, 0, 0, 0])], 44100);
	const view = new DataView(wav.buffer);
	assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
	assert.equal(new TextDecoder().decode(wav.subarray(8, 12)), 'WAVE');
	assert.deepEqual([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true), view.getUint32(40, true)], [2, 44100, 16, 16]);
	assert.equal(wav.byteLength, 44 + 16);
	assert.deepEqual([view.getInt16(44 + 4, true), view.getInt16(44 + 8, true), view.getInt16(44 + 12, true)], [32767, -32768, 16384]);
});
