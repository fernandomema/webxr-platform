import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { importFromLibrary, variantFor, canImportKind, canOptimizeKind, provenanceOf } = await import('../src/lib/studio/library/importers.ts');
const { packArmPixels, fitWithin } = await import('../src/lib/studio/content/imageOptimize.ts');

const CC0 = { name: 'CC0', commercialUse: true, attributionRequired: false };
const file = (role, format = 'jpg') => ({ role, url: `https://dl.example.com/${role}.${format}`, format });
const detail = (kind, variants, extra = {}) => ({ ref: 'polyhaven:thing', kind, title: 'Thing', license: CC0, tags: [], sourceUrl: 'https://polyhaven.com/a/thing', downloadable: true, variants, ...extra });

function fakeDeps({ model } = {}, opts) {
	const log = { downloads: [], stored: [], packed: [] };
	let counter = 0;
	return {
		log,
		deps: {
			download: async (ref, variant, role) => { log.downloads.push(`${variant}/${role}`); return new Uint8Array([role.length, 1, 2, 3]); },
			optimizeMap: async (bytes, map) => ({ bytes: new Uint8Array(bytes.length - 1), mimeType: 'image/webp' }),
			packArm: async (maps) => { log.packed.push(Object.keys(maps).sort()); return { bytes: new Uint8Array(2), mimeType: 'image/webp' }; },
			optimizeFile: async (kind, bytes) => (opts?.optimizer ? opts.optimizer(kind, bytes) : null),
			store: async (bytes, name, type, provenance) => {
				log.stored.push({ name, type, source: provenance.source });
				const assetId = `sha256:${String(++counter).padStart(64, '0')}`;
				return type === 'model' ? { assetId, type, ...(model ?? { triangles: 1200, bounds: { min: [0, 0, 0], max: [1, 2, 0.5] } }), byteSize: bytes.length } : { assetId, type, byteSize: bytes.length };
			}
		}
	};
}

test('a material brings in its colour, normal and ARM maps as optimized images, with the size of one repeat', async () => {
	const { deps, log } = fakeDeps();
	const result = await importFromLibrary(detail('material', [{ id: '1k', label: '1K', resolution: '1k', format: 'jpg', files: [file('albedo'), file('normal', 'png'), file('arm')] }], { facts: { realWorldSize: 2 } }), deps);
	assert.equal(result.kind, 'material');
	assert.equal(result.size, 2);
	assert.ok(result.albedo && result.normal && result.arm);
	assert.deepEqual(log.downloads.sort(), ['1k/albedo', '1k/arm', '1k/normal']);
	assert.deepEqual(log.stored.map((entry) => entry.name).sort(), ['Thing albedo.webp', 'Thing arm.webp', 'Thing normal.webp']);
	assert.ok(log.stored.every((entry) => entry.type === 'image' && entry.source === 'polyhaven'), 'every map remembers where it came from');
	assert.ok(result.bytes.stored < result.bytes.downloaded);
});

test('separate occlusion, roughness and metallic maps are packed into one ARM map', async () => {
	const { deps, log } = fakeDeps();
	const result = await importFromLibrary(detail('material', [{ id: '2k', label: '2K', resolution: '2k', format: 'jpg', files: [file('albedo'), file('roughness'), file('ao')] }]), deps);
	assert.deepEqual(log.packed, [['ao', 'roughness']]);
	assert.ok(result.arm && result.albedo);
	assert.equal(result.normal, null);
	assert.deepEqual(log.downloads.sort(), ['2k/albedo', '2k/ao', '2k/roughness']);
});

test('a material with nothing usable says so', async () => {
	const { deps } = fakeDeps();
	await assert.rejects(importFromLibrary(detail('material', [{ id: 'v', label: 'V', format: 'jpg', files: [file('height')] }]), deps), /no maps/);
});

test('a model is imported as a model asset and reports its real size', async () => {
	const { deps, log } = fakeDeps();
	const result = await importFromLibrary(detail('model', [{ id: 'glb', label: 'GLB', format: 'glb', files: [{ role: 'model', url: 'polyhaven://model/thing', format: 'glb' }] }]), deps);
	assert.deepEqual([result.kind, result.triangles, result.size], ['model', 1200, 2]);
	assert.deepEqual(log.stored, [{ name: 'Thing.glb', type: 'model', source: 'polyhaven' }]);
});

test('the variant is the one asked for, else the best size; GLB before glTF; unsupported ones are never used', () => {
	const model = detail('model', [
		{ id: 'fbx', label: 'FBX', format: 'fbx', unsupported: 'needs conversion', files: [file('model', 'fbx')] },
		{ id: 'gltf', label: 'glTF', format: 'gltf', files: [file('model', 'gltf')] },
		{ id: 'glb', label: 'GLB', format: 'glb', files: [file('model', 'glb')] }
	]);
	assert.equal(variantFor(model).id, 'glb');
	assert.equal(variantFor(model, { variantId: 'gltf' }).id, 'gltf');
	assert.equal(variantFor(model, { variantId: 'fbx' }), null, 'asking for an unsupported one gets nothing');
	const material = detail('material', ['1k', '2k', '4k'].map((resolution) => ({ id: resolution, label: resolution, resolution, format: 'jpg', files: [file('albedo')] })));
	assert.equal(variantFor(material).id, '1k');
	assert.equal(variantFor(material, { resolution: '4k' }).id, '4k');
});

test('what can not be imported explains why instead of failing mysteriously', async () => {
	const { deps } = fakeDeps();
	await assert.rejects(importFromLibrary(detail('font', [{ id: 'v', label: 'V', format: 'ttf', files: [file('other', 'ttf')] }]), deps), /not available yet/);
	await assert.rejects(importFromLibrary(detail('model', [], { downloadable: false }), deps), /own site/);
	await assert.rejects(importFromLibrary(detail('model', [{ id: 'fbx', label: 'FBX', format: 'fbx', unsupported: 'FBX needs conversion first.', files: [file('model', 'fbx')] }]), deps), /FBX needs conversion first/);
	await assert.rejects(importFromLibrary(detail('model', []), deps), /no version/);
	assert.deepEqual(['model', 'material', 'audio', 'image', 'hdri', 'font'].map(canImportKind), [true, true, true, true, false, false]);
});

test('provenance is plain data, even when it is built from a proxy, so it can be stored', () => {
	const proxy = (value) => new Proxy(value, {});
	const found = provenanceOf(proxy(detail('model', [], { license: proxy({ name: 'CC BY', commercialUse: true, attributionRequired: true }) })), 1);
	assert.doesNotThrow(() => structuredClone(found));
	assert.deepEqual(Object.keys(found.license).sort(), ['attributionRequired', 'commercialUse', 'name']);
});

test('provenance says who made it and under what license', () => {
	const found = provenanceOf(detail('model', [], { ref: 'shep:polyhaven:Chair', author: 'Someone', license: { name: 'CC BY 4.0', commercialUse: true, attributionRequired: true } }), 99);
	assert.deepEqual([found.source, found.ref, found.author, found.license.attributionRequired, found.importedAt], ['shep', 'shep:polyhaven:Chair', 'Someone', true, 99]);
});

test('ARM packing puts occlusion in red, roughness in green and metallic in blue, with neutral values for what is missing', () => {
	const grey = (...values) => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
	const packed = packArmPixels({ ao: grey(10, 20), roughness: grey(30, 40), metallic: grey(50, 60) }, 2);
	assert.deepEqual([...packed], [10, 30, 50, 255, 20, 40, 60, 255]);
	assert.deepEqual([...packArmPixels({ roughness: grey(100) }, 1)], [255, 100, 0, 255]);
});

test('images are scaled down to fit, never up', () => {
	assert.deepEqual(fitWithin(4096, 2048, 2048), { width: 2048, height: 1024 });
	assert.deepEqual(fitWithin(512, 256, 2048), { width: 512, height: 256 });
	assert.deepEqual(fitWithin(1, 4000, 2000), { width: 1, height: 2000 });
});

const glbDetail = () => detail('model', [{ id: 'glb', label: 'GLB', format: 'glb', files: [{ role: 'model', url: 'https://x/m.glb', format: 'glb' }] }]);

test('adding a model optimized stores the lighter file and reports the saving; plain adding does not optimize', async () => {
	const { deps, log } = fakeDeps({}, { optimizer: async (kind, bytes) => ({ bytes: bytes.slice(0, 2), extension: 'glb' }) });
	const plain = await importFromLibrary(glbDetail(), deps);
	assert.equal(plain.optimized, undefined);
	assert.equal(plain.byteSize, 4);
	const light = await importFromLibrary(glbDetail(), deps, { optimize: true });
	assert.deepEqual(light.optimized, { before: 4, after: 2 });
	assert.equal(light.byteSize, 2);
	assert.equal(log.stored.length, 2);
});

test('optimizing something that can not get lighter keeps the original and says so', async () => {
	for (const optimizer of [async () => null, async (kind, bytes) => ({ bytes: new Uint8Array(bytes.length + 5), extension: 'glb' }), async () => { throw new Error('no canvas'); }]) {
		const { deps } = fakeDeps({}, { optimizer });
		const result = await importFromLibrary(glbDetail(), deps, { optimize: true });
		assert.deepEqual(result.optimized, { before: 4, after: 4 });
		assert.equal(result.byteSize, 4);
	}
});

test('a sound and a picture are optimized the same way, and a changed format changes the name\'s extension', async () => {
	const { deps, log } = fakeDeps({}, { optimizer: async (kind, bytes) => ({ bytes: bytes.slice(0, 1), extension: kind === 'image' ? 'webp' : 'wav' }) });
	const picture = detail('image', [{ id: 'v', label: 'V', format: 'png', files: [{ role: 'image', url: 'https://x/p.png', format: 'png' }] }]);
	const sound = detail('audio', [{ id: 'v', label: 'V', format: 'wav', files: [{ role: 'audio', url: 'https://x/s.wav', format: 'wav' }] }]);
	assert.deepEqual((await importFromLibrary(picture, deps, { optimize: true })).optimized, { before: 4, after: 1 });
	assert.deepEqual((await importFromLibrary(sound, deps, { optimize: true })).optimized, { before: 4, after: 1 });
	assert.deepEqual(log.stored.map((entry) => entry.name), ['Thing.webp', 'Thing.wav']);
});

test('only models, pictures and sounds have a separate optimized option', () => {
	assert.deepEqual(['model', 'image', 'audio', 'material', 'hdri'].map(canOptimizeKind), [true, true, true, false, false]);
});

test('a height map is imported with the others, and one that cannot be fetched does not fail the material', async () => {
	const { deps, log } = fakeDeps();
	const result = await importFromLibrary(detail('material', [{ id: '1k', label: '1K', resolution: '1k', format: 'jpg', files: [file('albedo'), file('height')] }]), deps);
	assert.ok(result.albedo && result.height);
	assert.deepEqual(log.stored.map((entry) => entry.name).sort(), ['Thing albedo.webp', 'Thing height.webp']);
	const broken = fakeDeps();
	const download = broken.deps.download;
	broken.deps.download = async (ref, variant, role, ...rest) => { if (role === 'height') throw new Error('404'); return download(ref, variant, role, ...rest); };
	const partial = await importFromLibrary(detail('material', [{ id: '1k', label: '1K', resolution: '1k', format: 'jpg', files: [file('albedo'), file('height')] }]), broken.deps);
	assert.ok(partial.albedo);
	assert.equal(partial.height, null);
});
