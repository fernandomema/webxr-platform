import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wouldExceedQuota, canReleaseOwnership, planAssetGc } from '../src/lib/assets/accounting.ts';
import { validateManifest } from '../src/lib/assets/manifest.ts';

const id = (c) => 'sha256:' + c.repeat(64);
const day = 86_400_000;
const now = new Date('2026-10-01T00:00:00Z');
const ago = (days) => new Date(now.getTime() - days * day);
const row = (over = {}) => ({ id: id('a'), status: 'ready', createdAt: ago(30), orphanedAt: null, owners: 1, references: 0, ...over });

test('quota: joining as an owner is charged the full size, keeping what you own is free', () => {
  assert.equal(wouldExceedQuota({ used: 90, adding: 20, alreadyOwner: false, quota: 100 }), true);
  assert.equal(wouldExceedQuota({ used: 90, adding: 10, alreadyOwner: false, quota: 100 }), false);
  assert.equal(wouldExceedQuota({ used: 999, adding: 20, alreadyOwner: true, quota: 100 }), false);
  assert.equal(wouldExceedQuota({ used: 999, adding: 20, alreadyOwner: false, quota: 0 }), false); // 0 = unlimited
});

test('an owner can only release a model nothing of theirs uses', () => {
  assert.equal(canReleaseOwnership(0), true);
  assert.equal(canReleaseOwnership(2), false);
});

test('gc: an asset with an owner or a reference is never a candidate', () => {
  const plan = planAssetGc([row({ owners: 1 }), row({ id: id('b'), owners: 0, references: 1 })], now, { graceDays: 7 });
  assert.deepEqual(plan, { markOrphan: [], clearOrphan: [], delete: [], purgePending: [] });
});

test('gc: an unused asset is marked first, deleted only after the grace period', () => {
  const unused = { owners: 0, references: 0 };
  assert.deepEqual(planAssetGc([row(unused)], now, { graceDays: 7 }).markOrphan, [id('a')]);
  assert.deepEqual(planAssetGc([row({ ...unused, orphanedAt: ago(3) })], now, { graceDays: 7 }).delete, []);
  assert.deepEqual(planAssetGc([row({ ...unused, orphanedAt: ago(7) })], now, { graceDays: 7 }).delete, [id('a')]);
  assert.deepEqual(planAssetGc([row({ ...unused, orphanedAt: ago(30) })], now, { graceDays: 7 }).delete, [id('a')]);
});

test('gc: claiming an orphan during the grace period saves it', () => {
  const plan = planAssetGc([row({ owners: 1, orphanedAt: ago(5) }), row({ id: id('b'), owners: 0, references: 2, orphanedAt: ago(9) })], now, { graceDays: 7 });
  assert.deepEqual(plan.clearOrphan.sort(), [id('a'), id('b')]);
  assert.deepEqual(plan.delete, []);
});

test('gc: stale uploads that were never completed are purged, fresh ones are left alone', () => {
  const pending = { status: 'pending', owners: 0, references: 0 };
  const plan = planAssetGc([row({ ...pending, createdAt: new Date(now.getTime() - 25 * 3_600_000) }), row({ ...pending, id: id('b'), createdAt: new Date(now.getTime() - 3_600_000) })], now, { graceDays: 7 });
  assert.deepEqual(plan.purgePending, [id('a')]);
});

test('manifest validation accepts a real manifest and rejects hostile ones', () => {
  const ok = { assetId: id('c'), type: 'model', format: 'glb', mimeType: 'model/gltf-binary', byteSize: 1234, name: 'Chair', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, triangles: 12, meshes: 1, materials: 1, textures: 0 };
  assert.equal(validateManifest(ok).name, 'Chair');
  for (const bad of [null, { ...ok, assetId: 'sha256:xyz' }, { ...ok, format: 'gltf' }, { ...ok, byteSize: 0 }, { ...ok, byteSize: 26 * 1048576 }, { ...ok, name: '' }, { ...ok, bounds: { min: [0, 0], max: [1, 1, 1] } }, { ...ok, triangles: 400_000 }, { ...ok, meshes: -1 }]) {
    assert.throws(() => validateManifest(bad));
  }
});
