import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../packages/engine/src/assets/kinds/index.ts';
import { importAsset } from '../packages/engine/src/assets/importAsset.ts';
import { MemoryAssetStore } from '../packages/engine/src/assets/store.ts';
import { sniffAssetKind } from '../packages/engine/src/assets/kinds/index.ts';
import { validateManifest } from '../packages/engine/src/assets/manifest.ts';
import { collectAssetIds } from '../packages/engine/src/assets/ref.ts';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { FRAGMENT_LIMITS, FragmentError, expandFragments, instantiateFragment, parseFragment, serializeFragment } from '../packages/engine/src/assets/fragment.ts';
import { validateWorldScene } from '../packages/engine/src/worlds/package.ts';

const modelId = `sha256:${'b'.repeat(64)}`;
const fragId = `sha256:${'c'.repeat(64)}`;
const mesh = (id) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id } });
const room = () => [
	createSlot({ id: 'floor', name: 'floor', components: [mesh('box'), { type: 'collider', shape: 'box' }] }),
	createSlot({ id: 'group', name: 'group' }),
	createSlot({ id: 'lamp', parentId: 'group', name: 'lamp', position: [0, 2, 0], components: [{ type: 'pointLight', color: '#fff', intensity: 1, range: 5 }, { type: 'meshRenderer', meshRef: { kind: 'asset', assetId: modelId } }] })
];

test('a fragment round-trips, and what it may not hold is refused with a reason', () => {
	const bytes = serializeFragment(room(), 'room');
	assert.ok(new TextDecoder().decode(bytes.subarray(0, 40)).startsWith('{"format":"kithin-fragment"'), 'the format comes first');
	const data = parseFragment(bytes);
	assert.equal(data.slots.length, 3);
	assert.equal(data.name, 'room');
	const bad = (slots, code) => assert.throws(() => serializeFragment(slots), (e) => e instanceof FragmentError && e.code === code);
	bad([createSlot({ id: 'a', name: 'a', components: [{ type: 'codeBlock', code: 'return {}' }] })], 'component-not-allowed');
	bad([createSlot({ id: 'a', name: 'a', parentId: 'nope' })], 'missing-parent');
	bad([createSlot({ id: 'a', name: 'a', parentId: 'b' }), createSlot({ id: 'b', name: 'b', parentId: 'a' })], 'cycle');
	bad([], 'empty');
	assert.throws(() => parseFragment('{"format":"other"}'), (e) => e.code === 'not-a-fragment');
	assert.throws(() => parseFragment('nonsense'), (e) => e.code === 'not-a-fragment');
	assert.equal(FRAGMENT_LIMITS.maxSlots > 2000, true, 'a fragment may hold more than the whole world’s own list');
});

test('loaded twice, a fragment gets two sets of ids, its roots hung from each owner', () => {
	const data = parseFragment(serializeFragment(room()));
	const a = instantiateFragment('a', data), b = instantiateFragment('b', data);
	assert.deepEqual(a.map((s) => s.id), ['a::floor', 'a::group', 'a::lamp']);
	assert.deepEqual(a.map((s) => s.parentId), ['a', 'a', 'a::group']);
	assert.equal(new Set([...a, ...b].map((s) => s.id)).size, 6);
	const tree = [createSlot({ id: 'a', name: 'a', components: [{ type: 'fragment', source: { kind: 'asset', assetId: fragId } }] }), { ...createSlot({ id: 'off', name: 'off', components: [{ type: 'fragment', source: { kind: 'asset', assetId: fragId } }] }), disabled: true }];
	assert.equal(expandFragments(tree, () => data).length, 2 + 6);
	assert.equal(expandFragments(tree, () => data, { onlyEnabled: true }).length, 2 + 3, 'a switched-off fragment can be left out');
	assert.equal(expandFragments(tree, () => undefined).length, 2);
});

test('a fragment is a kind of asset: recognised, measured, its own assets listed, and counted in the world', async () => {
	const bytes = serializeFragment(room(), 'room');
	assert.equal(sniffAssetKind(bytes.subarray(0, 64))?.kind.type, 'fragment');
	assert.equal(sniffAssetKind(new TextEncoder().encode('{"format":"other"}')), null);
	const { manifest } = await importAsset(bytes, 'room.kfrag', new MemoryAssetStore());
	assert.equal(manifest.type, 'fragment');
	assert.equal(manifest.slots, 3);
	assert.deepEqual(manifest.assets, [modelId]);
	assert.equal(validateManifest(manifest).type, 'fragment');
	assert.throws(() => validateManifest({ ...manifest, slots: 0 }));
	await assert.rejects(() => importAsset(new TextEncoder().encode('{"format":"kithin-fragment","version":1,"slots":[]}'), 'x.kfrag', new MemoryAssetStore()), /no slots/);
	const owner = createSlot({ id: 'map', name: 'map', components: [{ type: 'fragment', source: { kind: 'asset', assetId: fragId } }] });
	assert.deepEqual([...collectAssetIds([owner])], [fragId]);
	assert.doesNotThrow(() => validateWorldScene([owner]));
	const url = createSlot({ id: 'u', name: 'u', components: [{ type: 'fragment', source: { kind: 'url', url: 'https://example.com/x' } }] });
	assert.throws(() => validateWorldScene([url]), /Invalid fragment source/);
});
