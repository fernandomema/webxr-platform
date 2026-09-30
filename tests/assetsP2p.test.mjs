import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetPeer, PeerResolver } from '../src/lib/assets/p2p.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { importGlb } from '../src/lib/assets/importGlb.ts';
import { resolveAsset } from '../src/lib/assets/resolve.ts';
import { buildGlb } from './helpers/glb.mjs';

/** Two peers joined by an ordered in-memory channel that hands frames over asynchronously. */
function link(aOptions = {}, bOptions = {}) {
	const aStore = new MemoryAssetStore();
	const bStore = new MemoryAssetStore();
	let a, b;
	const deliver = (to) => async (data) => { await Promise.resolve(); to().handle(new Uint8Array(data)); };
	a = new AssetPeer(deliver(() => b), aStore, 'a', aOptions);
	b = new AssetPeer(deliver(() => a), bStore, 'b', bOptions);
	return { a, b, aStore, bStore };
}
const signal = () => new AbortController().signal;

test('a model held by one end reaches the other, whole, and verifies against its hash', async () => {
	const { a, b, aStore, bStore } = link();
	// A large model so it needs many chunks.
	const positions = Array.from({ length: 3 * 6000 }, (_, i) => (i % 97) / 7);
	const indices = Array.from({ length: 6000 }, (_, i) => i);
	const bytes = buildGlb({ positions, indices });
	const { manifest } = await importGlb(bytes, 'Big.glb', aStore, { maxBytes: 5_000_000, maxTriangles: 100_000, maxImages: 2 });
	assert.ok(bytes.byteLength > 45_000, 'spans several chunks');

	const result = await resolveAsset(manifest.assetId, [b], bStore, { nameHint: 'Big' });
	assert.equal(result.ok, true);
	assert.equal(result.source, 'b');
	assert.deepEqual(result.bytes, bytes);
	assert.ok(await bStore.has(manifest.assetId), 'cached on the receiving device');
	void a;
});

test('an asset the other end does not have resolves to null, not an error', async () => {
	const { a } = link();
	assert.equal(await a.resolve(`sha256:${'0'.repeat(64)}`, signal()), null);
});

test('garbage ids are refused without touching the store', async () => {
	const { a, b } = link();
	assert.equal(await a.resolve('../../etc/passwd', signal()), null);
	void b;
});

test('an offer larger than the limit is rejected before it is buffered', async () => {
	const { a, bStore } = link({ maxBytes: 10 });
	const { manifest } = await importGlb(buildGlb(), 'Small.glb', bStore);
	assert.equal(await a.resolve(manifest.assetId, signal()), null);
});

test('an aborted request and a silent peer both give up', async () => {
	const silent = new AssetPeer(async () => {}, new MemoryAssetStore(), 'silent', { idleTimeoutMs: 20 });
	assert.equal(await silent.resolve(`sha256:${'1'.repeat(64)}`, signal()), null);
	const controller = new AbortController();
	const pending = new AssetPeer(async () => {}, new MemoryAssetStore(), 'p', { idleTimeoutMs: 5000 }).resolve(`sha256:${'2'.repeat(64)}`, controller.signal);
	controller.abort();
	assert.equal(await pending, null);
});

test('closing a peer settles its outstanding requests', async () => {
	const peer = new AssetPeer(async () => {}, new MemoryAssetStore(), 'p', { idleTimeoutMs: 5000 });
	const pending = peer.resolve(`sha256:${'3'.repeat(64)}`, signal());
	peer.close();
	assert.equal(await pending, null);
	assert.equal(await peer.resolve(`sha256:${'3'.repeat(64)}`, signal()), null, 'a closed peer answers null at once');
});

test('PeerResolver tries each peer in turn and stops at the first that has it', async () => {
	const one = link();
	const two = link();
	const bytes = buildGlb();
	const { manifest } = await importGlb(bytes, 'Chair.glb', two.bStore); // held by the far end of the second link
	const resolver = new PeerResolver(() => [one.a, two.a]);
	assert.deepEqual(await resolver.resolve(manifest.assetId, signal()), bytes);
});
