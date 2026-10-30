import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { collectAssetIds } from '../packages/engine/src/assets/ref.ts';
import { needsRebuild } from '../packages/engine/src/xr/slotRebuild.ts';
import { packNormalHeight, packSize } from '../packages/engine/src/xr/heightPack.ts';
import { isMaterialUrl, isValidMaterialMap, materialSourceKey, materialSources } from '../packages/engine/src/xr/materialSources.ts';

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

test('the height map is collected for upload like the other maps', () => {
	const tree = [sphere([{ type: 'material', height: { kind: 'asset', assetId }, parallax: 0.05 }])];
	assert.deepEqual([...collectAssetIds(tree)], [assetId]);
	assert.deepEqual(materialSources({ type: 'material', height: url('https://a.test/h.png') }), { height: url('https://a.test/h.png') });
});

test('the normal and height maps are packed with the height in the alpha and the red flipped', () => {
	const normal = [10, 20, 30, 255, 40, 50, 60, 255];
	const height = [200, 0, 0, 255, 7, 0, 0, 255];
	assert.deepEqual([...packNormalHeight(normal, height, 2)], [245, 20, 30, 200, 215, 50, 60, 7]);
	assert.deepEqual([...packNormalHeight(null, height, 2)], [128, 128, 255, 200, 128, 128, 255, 7], 'a flat normal stands in when there is none');
});

test('packed maps are brought under the size limit, keeping their proportions', () => {
	assert.deepEqual(packSize(512, 256), { width: 512, height: 256 });
	assert.deepEqual(packSize(4096, 2048), { width: 1024, height: 512 });
});
