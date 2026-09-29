// End-to-end check of the cloud model storage against a RUNNING dev server, the real database and the real S3 bucket.
//   ASSET_USER_QUOTA_BYTES=6000 npx vite dev --port 5180      (in one terminal)
//   BASE_URL=https://localhost:5180 node --experimental-transform-types tests/e2e/assets.e2e.mjs
// Not part of `npm test` (it needs the server, the database and S3).
import assert from 'node:assert/strict';
import { buildGlb } from '../helpers/glb.mjs';
import { assetIdOf } from '../../src/lib/assets/hash.ts';
import { parseGlb } from '../../src/lib/assets/glb.ts';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = process.env.BASE_URL ?? 'https://localhost:5180';
const run = Date.now().toString(36);

class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); }
  async request(path, { method = 'GET', json, body, headers = {} } = {}) {
    // Auth only trusts the dev origin https://*:5173; the request itself still goes to BASE.
    const h = { origin: 'https://localhost:5173', ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    const res = await fetch(new URL(path, BASE), { method, headers: h, body, redirect: 'manual' });
    for (const line of res.headers.getSetCookie?.() ?? []) { const [pair] = line.split(';'); const i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    return res;
  }
  async signUp() {
    const res = await this.request('/api/auth/sign-up/email', { method: 'POST', json: { name: this.name, email: `${this.name}-${run}@example.test`, password: 'test-password-123', username: `${this.name}${run}` } });
    assert.ok(res.ok, `sign up ${this.name}: ${res.status} ${await res.text()}`);
    return this;
  }
}

const manifestFor = async (bytes, name) => {
  const stats = parseGlb(bytes);
  return { assetId: await assetIdOf(bytes), type: 'model', format: 'glb', mimeType: 'model/gltf-binary', byteSize: bytes.byteLength, name, bounds: stats.bounds, triangles: stats.triangles, meshes: stats.meshes, materials: stats.materials, textures: stats.textures };
};

async function upload(client, bytes, name) {
  const manifest = await manifestFor(bytes, name);
  const first = await client.request('/api/assets/uploads', { method: 'POST', json: { manifest } });
  if (!first.ok) return { status: first.status, body: await first.text(), manifest };
  const answer = await first.json();
  if (answer.exists) return { exists: true, manifest };
  const put = await client.request(answer.upload.url, { method: 'PUT', body: bytes, headers: answer.upload.headers });
  assert.ok(put.ok, `PUT bytes ${put.status} ${await put.text()}`);
  const done = await client.request('/api/assets/uploads/complete', { method: 'POST', json: { assetId: manifest.assetId } });
  assert.ok(done.ok, `complete ${done.status} ${await done.text()}`);
  return { exists: false, manifest };
}

const A = await new Client('alice').signUp();
const B = await new Client('bob').signUp();
const anon = new Client('anon');
const step = (s) => console.log(`\n== ${s}`);

// A unique file per run so leftovers from earlier runs cannot make "new" look like "already stored".
const model = buildGlb({ positions: [0, 0, 0, 1 + (Date.now() % 7), 0, 0, 0, 2, 0.001 * (Date.now() % 997)] });
const modelId = await assetIdOf(model);
console.log('model', modelId.slice(0, 20), model.byteLength, 'bytes');

step('alice uploads a new model');
const first = await upload(A, model, 'Chair');
assert.equal(first.exists, false);

step('bob uploads the same file: no upload, just another owner');
const second = await upload(B, model, 'Bobs copy of the chair');
assert.equal(second.exists, true, 'the second upload must be deduplicated');

step('both are charged the full size');
for (const client of [A, B]) {
  const usage = await (await client.request('/api/assets/usage')).json();
  assert.equal(usage.bytes, model.byteLength, `${client.name} usage`);
  assert.equal(usage.count, 1);
}
const listing = await (await B.request('/api/assets')).json();
assert.equal(listing[0].name, 'Bobs copy of the chair', 'each owner keeps their own label');

step('bytes come back intact through the download URL');
const resolved = await (await A.request('/api/assets/resolve', { method: 'POST', json: { ids: [modelId] } })).json();
assert.ok(resolved.assets[modelId], 'owner can resolve');
const blob = await A.request(resolved.assets[modelId].url);
assert.ok(blob.ok, `download ${blob.status}`);
const downloaded = new Uint8Array(await blob.arrayBuffer());
assert.equal(await assetIdOf(downloaded), modelId, 'downloaded bytes hash to the same id');

step('an outsider cannot read a private model');
const outsider = await (await anon.request('/api/assets/resolve', { method: 'POST', json: { ids: [modelId] } })).json();
assert.deepEqual(outsider.assets, {});
assert.equal((await anon.request(`/api/assets/blob/${encodeURIComponent(modelId)}`)).status, 404);

step('publishing a scene that uses a model that is not in the cloud is refused, listing it');
const scene = (assetId) => [{ id: 'floor', parentId: null, name: 'Floor', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' } }] },
  { id: 'chair', parentId: null, name: 'Chair', position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId } }] }];
const ghost = 'sha256:' + 'ee'.repeat(32);
const refused = await A.request('/api/published-worlds', { method: 'POST', json: { name: `W${run}`, scene: scene(ghost) } });
assert.equal(refused.status, 409);
assert.deepEqual((await refused.json()).missing, [ghost]);

step('publishing with the model works, and the world becomes readable by anyone');
const published = await A.request('/api/published-worlds', { method: 'POST', json: { name: `World ${run}`, scene: scene(modelId) } });
assert.equal(published.status, 201, await published.clone().text());
const publication = await published.json();
const open = await (await anon.request('/api/assets/resolve', { method: 'POST', json: { ids: [modelId] } })).json();
assert.ok(open.assets[modelId], 'a model used by a published world is readable without signing in');

step('an owner cannot release a model their published world still uses; the other owner can');
assert.equal((await A.request(`/api/assets/${encodeURIComponent(modelId)}`, { method: 'DELETE' })).status, 400);
assert.equal((await B.request(`/api/assets/${encodeURIComponent(modelId)}`, { method: 'DELETE' })).status, 204);
assert.equal((await (await B.request('/api/assets/usage')).json()).bytes, 0, 'bob is no longer charged');
assert.equal((await (await A.request('/api/assets/usage')).json()).bytes, model.byteLength, 'alice still is');
assert.ok((await (await anon.request('/api/assets/resolve', { method: 'POST', json: { ids: [modelId] } })).json()).assets[modelId], 'the file survives');

step('a new revision of the published world records its models too');
const rev = await A.request(`/api/published-worlds/${publication.id}/revisions`, { method: 'POST', json: { scene: scene(modelId) } });
assert.equal(rev.status, 201, await rev.clone().text());

step('quota: the full size is charged even for a file that already exists');
let refusedByQuota = 0;
for (let i = 0; i < 20 && !refusedByQuota; i++) {
  const bytes = buildGlb({ positions: [0, 0, 0, 3, 0, 0, 0, 3 + i, i + Math.random()] });
  const result = await upload(B, bytes, `filler ${i}`);
  if (result.status === 413) refusedByQuota = i + 1;
}
assert.ok(refusedByQuota > 0, 'bob eventually hits the quota');
console.log(`   refused after ${refusedByQuota} models`);

step('input is validated');
assert.equal((await A.request('/api/assets/uploads', { method: 'POST', json: { manifest: { assetId: 'nope' } } })).status, 400);
assert.equal((await anon.request('/api/assets/uploads', { method: 'POST', json: { manifest: await manifestFor(model, 'x') } })).status, 401);
const wrong = await manifestFor(buildGlb({ positions: [0, 0, 0, 5, 0, 0, 0, 5, 1] }), 'Liar');
const wrongUp = await A.request('/api/assets/uploads', { method: 'POST', json: { manifest: wrong } });
const wrongTarget = await wrongUp.json();
// Same size, different content: the hash is what is checked, so the file is refused and never stored under that id.
const wrongPut = await A.request(wrongTarget.upload.url, { method: 'PUT', body: buildGlb({ positions: [0, 0, 0, 9, 0, 0, 0, 9, 1] }), headers: wrongTarget.upload.headers });
if (wrongPut.ok) {
  const wrongDone = await A.request('/api/assets/uploads/complete', { method: 'POST', json: { assetId: wrong.assetId } });
  assert.equal(wrongDone.status, 400, 'direct mode: completing an upload with the wrong bytes is refused');
} else assert.equal(wrongPut.status, 400, 'proxy mode: the wrong bytes are refused on arrival');
const stillNotReady = await (await A.request('/api/assets/resolve', { method: 'POST', json: { ids: [wrong.assetId] } })).json();
assert.deepEqual(stillNotReady.assets, {}, 'a model whose bytes never matched is never served');
// A different size is caught even earlier.
const shortPut = await A.request(wrongTarget.upload.url, { method: 'PUT', body: new Uint8Array(10), headers: wrongTarget.upload.headers });
assert.ok(shortPut.status >= 400 || (await A.request('/api/assets/uploads/complete', { method: 'POST', json: { assetId: wrong.assetId } })).status === 400, 'a wrong size is refused');

console.log('\nALL OK');
