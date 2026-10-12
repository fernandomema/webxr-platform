import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/assets/kinds/index.ts';
import { importAsset } from '../src/lib/assets/importAsset.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { sniffAssetKind } from '../src/lib/assets/kinds/index.ts';
import { validateManifest } from '../src/lib/assets/manifest.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createSlot } from '../src/lib/ecs/types.ts';
import { encode } from '../src/lib/lighting/format.ts';
import { nodeCodec } from '../src/lib/lighting/nodeCodec.ts';
import { slotIndex, voxelCount } from '../src/lib/lighting/types.ts';

// worlds/package.ts uses the app's `$lib` alias: load it with the alias pointed at the real files, as xrSceneGraph.test.mjs does.
const libUrl = new URL('../src/lib/', import.meta.url);
const packageCode = ts.transpileModule(await readFile(new URL('worlds/package.ts', libUrl), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
const { validateWorldScene } = await import(`data:text/javascript;base64,${Buffer.from(packageCode).toString('base64')}`);

function volumeFile() {
  const spec = { min: [-1, 0, 2], voxel: 0.5, dims: [6, 4, 5] };
  const data = new Float32Array(voxelCount(spec) * 18).fill(0.3);
  void slotIndex;
  return encode({ spec, data }, 'a'.repeat(32), nodeCodec);
}

test('a baked volume is recognised by its first bytes, imported with its grid in the manifest, and passes the server’s checks', async () => {
  const bytes = volumeFile();
  assert.equal(sniffAssetKind(bytes.subarray(0, 12))?.kind.type, 'lightmap');
  const store = new MemoryAssetStore();
  const { manifest } = await importAsset(bytes, 'room.lvol', store);
  assert.equal(manifest.type, 'lightmap');
  assert.deepEqual(manifest.dims, [6, 4, 5]);
  assert.equal(manifest.voxel, 0.5);
  assert.deepEqual(manifest.min, [-1, 0, 2]);
  assert.equal(manifest.signature, 'a'.repeat(32));
  assert.equal(validateManifest(manifest).type, 'lightmap');
});

test('anything else is not taken for a volume, and a damaged volume is refused with a reason', async () => {
  assert.equal(sniffAssetKind(new TextEncoder().encode('LVOX not it')), null);
  const store = new MemoryAssetStore();
  const broken = Uint8Array.from(volumeFile());
  broken[4] = 9;
  await assert.rejects(() => importAsset(broken, 'x.lvol', store), /not supported/);
  assert.equal((await store.list()).length, 0);
});

test('the server refuses lighting manifests with impossible grids', async () => {
  const store = new MemoryAssetStore();
  const { manifest } = await importAsset(volumeFile(), 'room.lvol', store);
  assert.throws(() => validateManifest({ ...manifest, dims: [0, 4, 5] }), /size/);
  assert.throws(() => validateManifest({ ...manifest, dims: [2000, 2000, 2000] }), /size|too many/);
  assert.throws(() => validateManifest({ ...manifest, voxel: -1 }), /voxel/);
  assert.throws(() => validateManifest({ ...manifest, min: [0, 0] }), /origin/);
  assert.throws(() => validateManifest({ ...manifest, signature: 'zz' }), /signature/);
  assert.throws(() => validateManifest({ ...manifest, mimeType: 'audio/mpeg' }), /format/);
});

const ID = `sha256:${'7'.repeat(64)}`;
const scene = (component) => [createSlot({ id: 'v', name: 'v', components: [component] })];

test('a world’s baked data is an asset it declares, so uploading, sharing and cleaning up find it', () => {
  const tree = scene({ type: 'lightVolume', data: { kind: 'asset', assetId: ID }, intensity: 1.5, tint: '#ff3b2f' });
  assert.deepEqual([...collectAssetIds(tree)], [ID]);
  assert.doesNotThrow(() => validateWorldScene(tree));
});

test('baked data that is an address, a missing reference, or a silly intensity or tint is refused', () => {
  const bad = [
    { type: 'lightVolume', data: { kind: 'url', url: 'https://example.com/a.lvol' } },
    { type: 'lightVolume' },
    { type: 'lightVolume', data: { kind: 'asset', assetId: 'sha256:short' } },
    { type: 'lightVolume', data: { kind: 'asset', assetId: ID }, intensity: -1 },
    { type: 'lightVolume', data: { kind: 'asset', assetId: ID }, intensity: 1e9 },
    { type: 'lightVolume', data: { kind: 'asset', assetId: ID }, tint: 'red' }
  ];
  for (const component of bad) assert.throws(() => validateWorldScene(scene(component)), /Invalid lighting/, JSON.stringify(component));
});
