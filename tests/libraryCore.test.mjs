import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAssetRef, parseAssetRef } from '../packages/engine/src/library/ref.ts';
import { allowsCommercialUse, describeLicense, CC0, UNKNOWN_LICENSE } from '../packages/engine/src/library/license.ts';
import { pickVariant, resolutionPixels } from '../packages/engine/src/library/variants.ts';
import { dropCovered, interleave } from '../packages/engine/src/library/merge.ts';
import { checkDetail, checkSummary } from '../packages/engine/src/library/validate.ts';

test('a ref splits at the first colon, so an aggregator\'s own ids survive', () => {
	assert.deepEqual(parseAssetRef('polyhaven:brick_wall_002'), { source: 'polyhaven', nativeId: 'brick_wall_002' });
	assert.deepEqual(parseAssetRef('shep:polyhaven:WoodenChair_01'), { source: 'shep', nativeId: 'polyhaven:WoodenChair_01' });
	assert.equal(formatAssetRef('shep', 'ambientcg:Bricks001'), 'shep:ambientcg:Bricks001');
	for (const bad of [null, '', 'nocolon', ':x', 'Bad Source:x', 'a:', `a:${'x'.repeat(201)}`, 'a:b\nc', 42]) assert.equal(parseAssetRef(bad), null, String(bad));
	assert.throws(() => formatAssetRef('Bad', 'x'));
});

test('only an explicit yes allows commercial use', () => {
	assert.equal(allowsCommercialUse(CC0), true);
	assert.equal(allowsCommercialUse(UNKNOWN_LICENSE), false);
	assert.equal(allowsCommercialUse({ name: 'CC BY-NC', commercialUse: false, attributionRequired: true }), false);
	assert.equal(allowsCommercialUse(undefined), false);
	assert.equal(describeLicense(CC0), 'CC0 1.0');
	assert.match(describeLicense({ name: 'CC BY', commercialUse: true, attributionRequired: true }), /credit required/);
});

const variant = (id, resolution, format = 'jpg', extra = {}) => ({ id, label: id, resolution, format, files: [{ role: 'albedo', url: 'https://x/y', format }], ...extra });

test('the closest resolution wins, the lighter one on a tie, and unsupported variants are never chosen', () => {
	assert.equal(resolutionPixels('2k'), 2048);
	assert.equal(resolutionPixels('512'), 512);
	assert.equal(resolutionPixels('big'), null);
	const list = [variant('a', '512'), variant('b', '2k'), variant('c', '4k'), variant('d', '1k', 'jpg', { unsupported: 'needs conversion' })];
	assert.equal(pickVariant(list, { resolution: '1k' }).id, 'a', '512 and 2k are equally far from 1k: the lighter one');
	assert.equal(pickVariant(list, { resolution: '4k' }).id, 'c');
	assert.equal(pickVariant(list.slice(3)), null);
	assert.equal(pickVariant([variant('x', '1k', 'glb'), variant('y', '1k', 'gltf')], { formats: ['fbx', 'gltf', 'glb'] }).id, 'y', 'the first format that exists wins');
	assert.equal(pickVariant([variant('n', undefined), variant('m', '1k')]).id, 'm', 'one with a size beats one without');
});

const summary = (ref) => ({ ref, kind: 'model', title: ref, license: CC0, tags: [], sourceUrl: 'https://example.com/a', downloadable: true });

test('an aggregator\'s copies of what a direct source serves are dropped from a merged list', () => {
	const infos = [{ id: 'polyhaven' }, { id: 'shep', covers: ['polyhaven'] }];
	const items = [summary('polyhaven:Chair'), summary('shep:polyhaven:Chair'), summary('shep:ambientcg:Bricks'), summary('shep:polyhaven:Table')];
	assert.deepEqual(dropCovered(items, infos).map((item) => item.ref), ['polyhaven:Chair', 'shep:ambientcg:Bricks']);
	assert.equal(dropCovered(items, [{ id: 'shep', covers: ['polyhaven'] }]).length, 4, 'with no direct source enabled nothing is dropped');
});

test('interleaving takes turns', () => {
	assert.deepEqual(interleave([[1, 2, 3], ['a'], ['x', 'y']]), [1, 'a', 'x', 2, 'y', 3]);
});

test('the checks name what is wrong with a source\'s answer', () => {
	assert.deepEqual(checkSummary(summary('polyhaven:a')), []);
	assert.ok(checkSummary({ ...summary('polyhaven:a'), sourceUrl: 'http://insecure' }).some((problem) => /sourceUrl/.test(problem)));
	assert.ok(checkSummary({ ...summary('x'), kind: 'sofa', license: { name: 'x' } }).length >= 3);
	assert.deepEqual(checkDetail({ ...summary('polyhaven:a'), variants: [variant('v', '1k')] }), []);
	assert.ok(checkDetail({ ...summary('polyhaven:a'), variants: [{ id: 'v', label: 'v', files: [] }] }).some((problem) => /files is empty/.test(problem)));
	assert.ok(checkDetail({ ...summary('polyhaven:a'), variants: [{ ...variant('v', '1k'), files: [{ role: 'teapot', url: '', format: '' }] }] }).length >= 3);
});

test('provenance is rebuilt from known fields, with nothing else let through', async () => {
	const { sanitizeProvenance, creditsFor } = await import('../packages/engine/src/library/provenance.ts');
	const good = { source: 'polyhaven', ref: 'polyhaven:brick', sourceUrl: 'https://polyhaven.com/a/brick', author: 'Someone', license: { name: 'CC0', commercialUse: true, attributionRequired: false, extra: 1 }, importedAt: 5, secret: 'x' };
	const clean = sanitizeProvenance(good);
	assert.equal('secret' in clean, false);
	assert.equal('extra' in clean.license, false);
	assert.equal(clean.license.commercialUse, true);
	for (const bad of [null, {}, { ...good, sourceUrl: 'http://insecure' }, { ...good, license: {} }, { ...good, ref: '' }]) assert.equal(sanitizeProvenance(bad), null);
	assert.equal(sanitizeProvenance({ ...good, license: { name: 'x', commercialUse: 'maybe' } }).license.commercialUse, 'unknown');
	assert.equal(sanitizeProvenance({ ...good, author: 'x'.repeat(500) }).author.length, 120);

	const by = (ref, attributionRequired, name = ref) => ({ name, provenance: { ...clean, ref, license: { ...clean.license, attributionRequired } } });
	const credits = creditsFor([by('a:1', true, 'Chair'), by('a:1', true, 'Chair again'), by('a:2', false), { name: 'Mine' }, by('a:3', true, 'Armchair')]);
	assert.deepEqual(credits.map((entry) => entry.title), ['Armchair', 'Chair'], 'only what asks for credit, once each, in order');
});

test('importing records where a file came from, and a second import of the same bytes adds it to what was stored without it', async () => {
	const { importAsset } = await import('../packages/engine/src/assets/importAsset.ts');
	const { MemoryAssetStore } = await import('../packages/engine/src/assets/store.ts');
	const { sanitizeProvenance } = await import('../packages/engine/src/library/provenance.ts');
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]);
	const provenance = sanitizeProvenance({ source: 'polyhaven', ref: 'polyhaven:x', sourceUrl: 'https://polyhaven.com/a/x', license: { name: 'CC0', commercialUse: true, attributionRequired: false }, importedAt: 1 });
	const store = new MemoryAssetStore();
	const first = await importAsset(png, 'plain.png', store);
	assert.equal(first.manifest.provenance, undefined);
	const again = await importAsset(png, 'plain.png', store, { provenance });
	assert.equal(again.alreadyStored, true);
	assert.equal((await store.list())[0].provenance.ref, 'polyhaven:x');
	const other = new MemoryAssetStore();
	assert.equal((await importAsset(png, 'x.png', other, { provenance })).manifest.provenance.source, 'polyhaven');
	assert.equal(first.manifest.assetId, (await importAsset(png, 'x.png', new MemoryAssetStore(), { provenance })).manifest.assetId, 'provenance never changes the asset id');
});

test('the server keeps only a clean provenance when it records a manifest', async () => {
	const { validateManifest } = await import('../packages/engine/src/assets/manifest.ts');
	const base = { assetId: `sha256:${'a'.repeat(64)}`, type: 'image', format: 'png', mimeType: 'image/png', byteSize: 100, name: 'x', width: 4, height: 4 };
	assert.equal('provenance' in validateManifest({ ...base, provenance: { evil: true } }), false);
	assert.equal(validateManifest({ ...base, provenance: { source: 'polyhaven', ref: 'polyhaven:x', sourceUrl: 'https://polyhaven.com/a/x', license: { name: 'CC0' }, importedAt: 1, junk: 1 } }).provenance.license.commercialUse, 'unknown');
});

test('credits read as one line each', async () => {
	const { creditsText } = await import('../packages/engine/src/library/provenance.ts');
	assert.equal(creditsText([{ title: 'Chair', author: 'Ana', license: 'CC BY 4.0', sourceUrl: 'https://x.example/chair', ref: 'a:1' }, { title: 'Wall', license: 'CC BY 4.0', sourceUrl: 'https://x.example/wall', ref: 'a:2' }]), 'Chair by Ana — CC BY 4.0 (https://x.example/chair)\nWall — CC BY 4.0 (https://x.example/wall)');
	assert.equal(creditsText([]), '');
});
