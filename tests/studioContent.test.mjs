import test from 'node:test';
import assert from 'node:assert/strict';

const { describeFields } = await import('../src/lib/studio/content/describe.ts');
const { assetIdsIn, isUnused, isRemovable, totalBytes } = await import('../src/lib/studio/content/entries.ts');

const id = (c) => `sha256:${c.repeat(64)}`;

test('assetIdsIn finds every asset id anywhere in a scene, once', () => {
	const scene = { slots: [{ components: [{ meshRef: { kind: 'asset', assetId: id('a') } }, { source: { assetId: id('b') } }] }, { name: id('a') }] };
	assert.deepEqual([...assetIdsIn(scene)].sort(), [id('a'), id('b')]);
	assert.equal(assetIdsIn(undefined).size, 0);
});

test('describeFields turns kind-specific manifest fields into readable rows', () => {
	const fields = describeFields({
		assetId: id('a'), type: 'model', format: 'glb', mimeType: 'model/gltf-binary', byteSize: 10, name: 'Chair',
		bounds: { min: [0, 0, 0], max: [1, 2.5, 0.5] }, triangles: 12000, meshes: 2, materials: 1, textures: 0, skeleton: { joints: ['a', 'b', 'c'] }
	});
	const byLabel = Object.fromEntries(fields.map((field) => [field.label, field.value]));
	assert.equal(byLabel.Dimensions, '1 × 2.5 × 0.5 m');
	assert.equal(byLabel.Skeleton, '3 bones');
	assert.ok(!('Asset id' in byLabel) && !('Name' in byLabel));
	assert.equal(describeFields({ assetId: id('b'), type: 'audio', format: 'mp3', mimeType: 'audio/mpeg', byteSize: 1, name: 'x', duration: 3.456, channels: 2, sampleRate: 44100 }).find((field) => field.label === 'Sample rate').value, '44100 Hz');
});

test('an asset is unused only when the storage says nothing uses it, and the cloud refuses to drop a used one', () => {
	const entry = (usedBy) => ({ assetId: id('a'), manifest: { byteSize: 5 }, addedAt: null, lastUsedAt: null, usedBy });
	assert.equal(isUnused(entry(null)), false);
	assert.equal(isUnused(entry({ items: 0, worlds: 0, publications: 0 })), true);
	assert.equal(isUnused(entry({ items: 0, worlds: 1, publications: 0 })), false);
	assert.equal(isRemovable({ adapterId: 'cloud' }, entry({ items: 1, worlds: 0, publications: 0 })), false);
	assert.equal(isRemovable({ adapterId: 'local' }, entry({ items: 1, worlds: 0, publications: 0 })), true);
	assert.equal(totalBytes([entry(null), entry(null)]), 10);
});
