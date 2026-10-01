import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeshRef, migrateSlotTree, collectAssetIds, isAssetId, meshRefKey, builtinMesh } from '../src/lib/assets/ref.ts';

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const slot = (id, components) => ({ id, parentId: null, name: id, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });

test('legacy strings and current objects normalize to the same reference', () => {
  assert.deepEqual(normalizeMeshRef('box'), { kind: 'builtin', id: 'box' });
  assert.deepEqual(normalizeMeshRef('cylinder'), { kind: 'builtin', id: 'cylinder' });
  assert.deepEqual(normalizeMeshRef(`asset:${A}`), { kind: 'asset', assetId: A });
  assert.deepEqual(normalizeMeshRef(A), { kind: 'asset', assetId: A });
  assert.deepEqual(normalizeMeshRef({ kind: 'asset', assetId: A }), { kind: 'asset', assetId: A });
  assert.deepEqual(normalizeMeshRef({ kind: 'builtin', id: 'sphere' }), { kind: 'builtin', id: 'sphere' });
});

test('anything unrecognised falls back to a box, like the old renderer did', () => {
  for (const bad of ['https://example.com/x.glb', 'teapot', '', 42, null, undefined, {}, { kind: 'asset', assetId: 'sha256:short' }, { kind: 'builtin', id: 'torus' }]) {
    assert.deepEqual(normalizeMeshRef(bad), { kind: 'builtin', id: 'box' }, String(JSON.stringify(bad)));
  }
});

test('isAssetId only accepts 64 lowercase hex digits', () => {
  assert.ok(isAssetId(A));
  assert.ok(!isAssetId('sha256:' + 'A'.repeat(64)));
  assert.ok(!isAssetId('sha256:' + 'a'.repeat(63)));
  assert.ok(!isAssetId('md5:' + 'a'.repeat(64)));
});

test('migrateSlotTree upgrades legacy meshRefs, including inside portals, without mutating its input', () => {
  const inner = [slot('n', [{ type: 'meshRenderer', meshRef: `asset:${B}` }])];
  const tree = [
    slot('a', [{ type: 'meshRenderer', meshRef: 'ground', color: '#fff' }, { type: 'collider', shape: 'box' }]),
    slot('p', [{ type: 'worldPortal', world: { formatVersion: 1, name: 'W', scene: inner, defaultVisibility: 'private' } }])
  ];
  const before = JSON.stringify(tree);
  const out = migrateSlotTree(tree);
  assert.equal(JSON.stringify(tree), before);
  assert.deepEqual(out[0].components[0], { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#fff' });
  assert.deepEqual(out[1].components[0].world.scene[0].components[0].meshRef, { kind: 'asset', assetId: B });
  // Idempotent.
  assert.deepEqual(migrateSlotTree(out), out);
});

test('collectAssetIds walks nested portals once and ignores primitives', () => {
  const inner = [slot('n', [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: B } }])];
  const tree = [
    slot('a', [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: A } }]),
    slot('b', [{ type: 'meshRenderer', meshRef: 'box' }]),
    slot('c', [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: A } }]),
    slot('p', [{ type: 'worldPortal', world: { scene: inner } }])
  ];
  assert.deepEqual([...collectAssetIds(tree)].sort(), [A, B]);
  assert.equal(collectAssetIds([]).size, 0);
});

test('portal nesting is capped so a hostile package cannot recurse forever', () => {
  let scene = [slot('leaf', [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: A } }])];
  for (let i = 0; i < 10; i++) scene = [slot(`p${i}`, [{ type: 'worldPortal', world: { scene } }])];
  assert.equal(collectAssetIds(scene).size, 0); // deeper than the cap: not followed
  assert.doesNotThrow(() => migrateSlotTree(scene));
});

test('meshRefKey distinguishes builtin from asset', () => {
  assert.notEqual(meshRefKey(builtinMesh('box')), meshRefKey({ kind: 'asset', assetId: A }));
});

test('skybox reflection images are collected with the world assets', () => {
  const tree = [slot('sky', [{ type: 'skybox', reflectionPx: { kind: 'asset', assetId: A }, reflectionNy: { kind: 'asset', assetId: B }, reflectionPz: { kind: 'url', url: 'https://example.com/face.png' } }])];
  assert.deepEqual([...collectAssetIds(tree)].sort(), [A, B]);
});
