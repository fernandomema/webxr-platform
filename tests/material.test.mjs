import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../src/lib/ecs/types.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';
import { needsRebuild } from '../src/lib/xr/slotRebuild.ts';
import { isMaterialUrl, isValidMaterialMap, materialSourceKey, materialSources } from '../src/lib/xr/materialSources.ts';

const assetId = `sha256:${'a'.repeat(64)}`;
const url = (value) => ({ kind: 'url', url: value });
const sphere = (components = []) => createSlot({ id: 's', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' } }, ...components] });

test('a material map may be a picture at any https address, or an asset', () => {
	assert.ok(isMaterialUrl('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick/brick_diffuse_1k.jpg'));
	assert.ok(isMaterialUrl('https://example.com/a.png'));
	assert.ok(!isMaterialUrl('http://example.com/a.png'));
	assert.ok(!isMaterialUrl('javascript:alert(1)'));
	assert.ok(!isMaterialUrl('not a url'));
	assert.ok(!isMaterialUrl('https://example.com/' + 'a'.repeat(2100)));
	assert.deepEqual(materialSources({ type: 'material', albedo: url('https://a.test/x.jpg'), normal: url('http://a.test/n.jpg'), arm: { kind: 'asset', assetId } }), { albedo: url('https://a.test/x.jpg'), arm: { kind: 'asset', assetId } });
});

test('slots that use the same picture share a texture, and an unusable map has no key', () => {
	assert.equal(materialSourceKey(url('https://a.test/x.jpg')), materialSourceKey(url('https://a.test/x.jpg')));
	assert.notEqual(materialSourceKey(url('https://a.test/x.jpg')), materialSourceKey({ kind: 'asset', assetId }));
	assert.equal(materialSourceKey(url('http://a.test/x.jpg')), null);
	assert.equal(materialSourceKey(undefined), null);
});

test('only asset maps are collected for upload; addresses travel as they are', () => {
	const tree = [sphere([{ type: 'material', albedo: url('https://a.test/x.jpg'), arm: { kind: 'asset', assetId } }])];
	assert.deepEqual([...collectAssetIds(tree)], [assetId]);
});

test('a stored map is valid only as an asset id or an https address', () => {
	assert.ok(isValidMaterialMap(url('https://a.test/x.jpg')));
	assert.ok(isValidMaterialMap({ kind: 'asset', assetId }));
	assert.ok(!isValidMaterialMap(url('http://a.test/x.jpg')));
	assert.ok(!isValidMaterialMap({ kind: 'asset', assetId: 'sha256:short' }));
	assert.ok(!isValidMaterialMap({ kind: 'file' }));
	assert.ok(!isValidMaterialMap(null));
});

test('gaining or losing a material rebuilds the slot, changing it does not', () => {
	const plain = sphere();
	const brick = sphere([{ type: 'material', albedo: url('https://a.test/brick.jpg') }]);
	const wood = sphere([{ type: 'material', albedo: url('https://a.test/wood.jpg'), tiling: 2 }]);
	assert.equal(needsRebuild(plain, brick), true, 'it may have been an instance of a shared mesh');
	assert.equal(needsRebuild(brick, plain), true);
	assert.equal(needsRebuild(brick, wood), false, 'the maps are swapped in place');
});
