import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlb, GlbError } from '../src/lib/assets/glb.ts';
import { sha256Hex, assetIdOf } from '../src/lib/assets/hash.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { importGlb, modelNameFromFile } from '../src/lib/assets/importGlb.ts';
import { isAssetId } from '../src/lib/assets/ref.ts';
import { buildGlb } from './helpers/glb.mjs';

const limits = { maxBytes: 1_000_000, maxTriangles: 100, maxImages: 2 };
const fails = (bytes, code, l = limits) => assert.throws(() => parseGlb(bytes, l), (e) => e instanceof GlbError && e.code === code, code);

test('a valid glb reports bounds, triangles and counts', () => {
  const stats = parseGlb(buildGlb({ positions: [-1, 0, -2, 3, 1, -2, -1, 4, 5], indices: [0, 1, 2] }), limits);
  assert.deepEqual(stats.bounds, { min: [-1, 0, -2], max: [3, 4, 5] });
  assert.equal(stats.triangles, 1);
  assert.equal(stats.meshes, 1);
  assert.equal(stats.materials, 1);
});

test('node transforms are applied to the bounds', () => {
  const stats = parseGlb(buildGlb({ nodes: [{ mesh: 0, scale: [2, 2, 2], translation: [10, 0, 0] }] }), limits);
  assert.deepEqual(stats.bounds, { min: [10, 0, 0], max: [12, 2, 0] });
  // A rotation of 90 degrees about Z turns +X into +Y.
  const s = Math.SQRT1_2;
  const rotated = parseGlb(buildGlb({ nodes: [{ mesh: 0, rotation: [0, 0, s, s] }] }), limits);
  // (x, y) -> (-y, x): the triangle (0,0) (1,0) (0,1) becomes (0,0) (0,1) (-1,0).
  assert.ok(Math.abs(rotated.bounds.max[1] - 1) < 1e-6 && Math.abs(rotated.bounds.min[0] + 1) < 1e-6 && Math.abs(rotated.bounds.max[0]) < 1e-6);
});

test('a mesh used by several nodes counts every instance', () => {
  const stats = parseGlb(buildGlb({ nodes: [{ children: [1, 2] }, { mesh: 0 }, { mesh: 0, translation: [5, 0, 0] }], extra: { scenes: [{ nodes: [0] }] } }), limits);
  assert.equal(stats.triangles, 2);
  assert.equal(stats.bounds.max[0], 6);
});

test('rejects things that are not a usable glb', () => {
  fails(buildGlb({ corrupt: 'magic' }), 'not-glb');
  fails(new Uint8Array(5), 'not-glb');
  fails(buildGlb({ version: 1 }), 'version');
  fails(buildGlb({ corrupt: 'length' }), 'length');
  fails(buildGlb(), 'too-large', { ...limits, maxBytes: 100 });
  fails(buildGlb({ positions: [0, 0, 0], indices: [] }), 'empty');
});

test('rejects models that need a downloaded decoder, whether required or merely used', () => {
  for (const name of ['EXT_meshopt_compression', 'KHR_texture_basisu']) {
    fails(buildGlb({ extensionsUsed: [name], extensionsRequired: [name] }), 'extension');
    fails(buildGlb({ extensionsUsed: [name] }), 'extension');
  }
  fails(buildGlb({ extensionsRequired: ['VENDOR_made_up'] }), 'extension');
  // Draco is decoded with the decoder bundled in /static/draco.
  assert.doesNotThrow(() => parseGlb(buildGlb({ extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }), limits));
  assert.doesNotThrow(() => parseGlb(buildGlb({ extensionsUsed: ['KHR_materials_unlit'], extensionsRequired: ['KHR_materials_unlit'] }), limits));
});

test('rejects external files but allows embedded data', () => {
  fails(buildGlb({ images: [{ uri: 'https://example.com/a.png' }] }), 'external-uri');
  fails(buildGlb({ images: [{ uri: 'textures/a.png' }] }), 'external-uri');
  fails(buildGlb({ buffers: [{ byteLength: 1, uri: 'model.bin' }] }), 'external-uri');
  assert.doesNotThrow(() => parseGlb(buildGlb({ images: [{ uri: 'data:image/png;base64,AAAA' }] }), limits));
});

test('enforces the triangle and image budgets', () => {
  fails(buildGlb({ positions: new Array(30).fill(0).map((_, i) => i % 5), indices: new Array(303).fill(0).map((_, i) => i % 10) }), 'too-many-triangles');
  fails(buildGlb({ images: [{}, {}, {}] }), 'too-many-images');
});

test('sha256 matches the known vector and asset ids are well formed', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const id = await assetIdOf(new TextEncoder().encode('abc'));
  assert.ok(isAssetId(id));
});

test('importing stores once and reuses the asset when the same bytes come again', async () => {
  const store = new MemoryAssetStore();
  const bytes = buildGlb();
  const first = await importGlb(bytes, 'My_chair-model.glb', store, limits);
  assert.equal(first.alreadyStored, false);
  assert.equal(first.manifest.name, 'My chair model');
  const again = await importGlb(bytes.slice(), 'renamed.glb', store, limits);
  assert.equal(again.alreadyStored, true);
  assert.equal(again.manifest.assetId, first.manifest.assetId);
  assert.deepEqual(await store.usage(), { count: 1, bytes: bytes.byteLength });
  assert.deepEqual([...(await store.getBytes(first.manifest.assetId))], [...bytes]);
  // A different file is a different asset.
  const other = await importGlb(buildGlb({ positions: [0, 0, 0, 2, 0, 0, 0, 2, 0] }), 'b.glb', store, limits);
  assert.notEqual(other.manifest.assetId, first.manifest.assetId);
  assert.equal((await store.list()).length, 2);
  await store.delete(first.manifest.assetId);
  assert.equal(await store.has(first.manifest.assetId), false);
});

test('an invalid file is never stored', async () => {
  const store = new MemoryAssetStore();
  await assert.rejects(() => importGlb(buildGlb({ corrupt: 'magic' }), 'x.glb', store, limits), GlbError);
  assert.equal((await store.usage()).count, 0);
  assert.equal(modelNameFromFile('.glb'), 'Model');
});

test('skin joints are reported by name, deduplicated, and absent without a skin', () => {
  const nodes = [{ mesh: 0, children: [1] }, { name: 'Hips', children: [2, 3] }, { name: 'Head' }, { name: 'Hips' }, {}];
  const skinned = parseGlb(buildGlb({ nodes, extra: { skins: [{ joints: [1, 2, 3, 4] }, { joints: [2] }] } }), limits);
  assert.deepEqual(skinned.skeleton, { joints: ['Hips', 'Head'] });
  assert.equal(parseGlb(buildGlb(), limits).skeleton, undefined);
});

test('importing a skinned model keeps its bone names in the manifest', async () => {
  const nodes = [{ mesh: 0, children: [1] }, { name: 'Hips', children: [2] }, { name: 'Head' }];
  const store = new MemoryAssetStore();
  const { manifest } = await importGlb(buildGlb({ nodes, extra: { skins: [{ joints: [1, 2] }] } }), 'Bot.glb', store, limits);
  assert.deepEqual(manifest.skeleton, { joints: ['Hips', 'Head'] });
  const plain = await importGlb(buildGlb(), 'Box.glb', store, limits);
  assert.equal(plain.manifest.skeleton, undefined);
});
