import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAsset } from '../src/lib/assets/resolve.ts';
import { normalizedExtents, normalizationTransform } from '../src/lib/assets/normalize.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { importGlb } from '../src/lib/assets/importGlb.ts';
import { assetIdOf } from '../src/lib/assets/hash.ts';
import { buildGlb } from './helpers/glb.mjs';

const source = (name, fn) => ({ name, resolve: fn });

test('this device wins, and no remote source is asked', async () => {
  const store = new MemoryAssetStore();
  const bytes = buildGlb();
  const { manifest } = await importGlb(bytes, 'a.glb', store);
  let asked = 0;
  const result = await resolveAsset(manifest.assetId, [source('cloud', async () => { asked++; return null; })], store);
  assert.ok(result.ok && result.source === 'device');
  assert.equal(asked, 0);
});

test('remote bytes are verified, cached on the device and reused', async () => {
  const bytes = buildGlb({ positions: [0, 0, 0, 2, 0, 0, 0, 2, 0] });
  const id = await assetIdOf(bytes);
  const store = new MemoryAssetStore();
  let downloads = 0;
  const cloud = source('cloud', async () => { downloads++; return bytes; });
  const first = await resolveAsset(id, [cloud], store, { nameHint: 'Chair' });
  assert.ok(first.ok && first.source === 'cloud');
  assert.equal((await store.getManifest(id)).name, 'Chair');
  const second = await resolveAsset(id, [cloud], store);
  assert.ok(second.ok && second.source === 'device');
  assert.equal(downloads, 1);
});

test('a source that returns the wrong bytes is skipped, not trusted', async () => {
  const wanted = await assetIdOf(buildGlb());
  const wrong = buildGlb({ positions: [0, 0, 0, 5, 0, 0, 0, 5, 0] });
  const good = buildGlb();
  const store = new MemoryAssetStore();
  const result = await resolveAsset(wanted, [source('liar', async () => wrong), source('host', async () => good)], store);
  assert.ok(result.ok && result.source === 'host');
  assert.equal((await store.usage()).count, 1);
});

test('only wrong or invalid data reports invalid; otherwise the model is unavailable', async () => {
  const wanted = await assetIdOf(buildGlb());
  const store = new MemoryAssetStore();
  const lied = await resolveAsset(wanted, [source('liar', async () => buildGlb({ positions: [0, 0, 0, 9, 0, 0, 0, 9, 0] }))], store);
  assert.deepEqual([lied.ok, lied.reason], [false, 'invalid']);
  const none = await resolveAsset(wanted, [source('a', async () => null), source('b', async () => { throw new Error('offline'); })], store);
  assert.deepEqual([none.ok, none.reason], [false, 'unavailable']);
  assert.equal((await store.usage()).count, 0);
});

test('an aborted request stops asking sources', async () => {
  const controller = new AbortController();
  controller.abort();
  let asked = 0;
  const result = await resolveAsset(await assetIdOf(buildGlb()), [source('s', async () => { asked++; return null; })], new MemoryAssetStore(), { signal: controller.signal });
  assert.equal(result.ok, false);
  assert.equal(asked, 0);
});

test('normalization: largest side becomes 1 and the model is centred', () => {
  assert.deepEqual(normalizedExtents({ min: [0, 0, 0], max: [2, 4, 1] }), [0.5, 1, 0.25]);
  assert.deepEqual(normalizedExtents(undefined), [1, 1, 1]);
  assert.deepEqual(normalizedExtents({ min: [1, 1, 1], max: [1, 1, 1] }), [1, 1, 1]);
  const { scale, offset } = normalizationTransform({ min: [2, 0, 0], max: [6, 2, 2] });
  assert.equal(scale, 0.25);
  assert.deepEqual(offset, [-1, -0.25, -0.25]);
});
