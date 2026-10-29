import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { MemoryAssetStore } from '../packages/engine/src/assets/store.ts';
import { importAsset } from '../packages/engine/src/assets/importAsset.ts';
import { serializeFragment } from '../packages/engine/src/assets/fragment.ts';
import { crc32, readZipDirectory, readZipEntry, writeZip } from '../packages/engine/src/container/zip.ts';
import { containerFileName, exportContainer, importContainer, readContainer } from '../packages/engine/src/container/kithinFile.ts';

const text = (s) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const png = (w, h, tag = 0) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, tag, 0, 0, 0, 0]);
const wav = () => new Uint8Array([...text('RIFF'), ...le32(36), ...text('WAVE'), ...text('fmt '), ...le32(16), 1, 0, 1, 0, ...le32(44100), ...le32(88200), 2, 0, 16, 0, ...text('data'), ...le32(0)]);

const slot = (id, components, extra = {}) => createSlot({ id, name: id, components, ...extra });
const withAssets = async () => {
	const store = new MemoryAssetStore();
	const picture = (await importAsset(png(8, 8), 'wall.png', store)).manifest.assetId;
	const inner = (await importAsset(png(4, 4, 1), 'inner.png', store)).manifest.assetId;
	const sound = (await importAsset(wav(), 'chime.wav', store)).manifest.assetId;
	const fragment = (await importAsset(serializeFragment([slot('r', [{ type: 'material', albedo: { kind: 'asset', assetId: inner } }])]), 'room.kfrag', store)).manifest.assetId;
	return { store, picture, inner, sound, fragment };
};
const worldScene = ({ picture, sound, fragment }) => [
	slot('root', [{ type: 'worldSettings', description: 'A test world' }]),
	slot('wall', [{ type: 'material', albedo: { kind: 'asset', assetId: picture } }], { parentId: 'root' }),
	slot('bell', [{ type: 'audioPlayer', source: { kind: 'asset', assetId: sound } }], { parentId: 'root' }),
	slot('room', [{ type: 'fragment', source: { kind: 'asset', assetId: fragment } }], { parentId: 'root' })
];

test('the zip writer and reader round-trip stored and deflated entries and check them', async () => {
	const big = new TextEncoder().encode('kithin '.repeat(5000));
	const bytes = await writeZip([{ path: 'a.txt', data: new TextEncoder().encode('hi') }, { path: 'dir/big.txt', data: big, compress: true }]);
	const dir = readZipDirectory(bytes);
	assert.deepEqual(dir.map((e) => e.path), ['a.txt', 'dir/big.txt']);
	assert.equal(dir[1].method, 8);
	assert.ok(dir[1].compressedSize < big.length / 10);
	assert.deepEqual(await readZipEntry(bytes, dir[1]), big);
	assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
	const damaged = bytes.slice();
	damaged[30 + 5 + 1] ^= 0xff; // inside the first entry's data
	await assert.rejects(readZipEntry(damaged, readZipDirectory(damaged)[0]), /damaged/);
});

test('the zip reader refuses unsafe names and files that are not archives', async () => {
	await assert.rejects(writeZip([{ path: '../x', data: new Uint8Array(1) }]), /Invalid/);
	assert.throws(() => readZipDirectory(new Uint8Array([1, 2, 3, 4, 5])), /not a Kithin file/);
});

test('a world exports with every asset it needs, including those used by its fragments, and imports on a clean device', async () => {
	const ids = await withAssets();
	const scene = worldScene(ids);
	const out = await exportContainer({ kind: 'world', name: 'Test: world?', scene, thumbnail: ids.picture }, ids.store);
	assert.equal(out.fileName, 'Test world.kiw');
	assert.deepEqual(out.missing, []);
	assert.equal(out.assetCount, 4);

	const clean = new MemoryAssetStore();
	const imported = await importContainer(out.bytes, clean);
	assert.equal(imported.kind, 'world');
	assert.equal(imported.name, 'Test: world?');
	assert.deepEqual(imported.scene, scene);
	assert.equal(imported.thumbnail, ids.picture);
	assert.equal(imported.added, 4);
	assert.deepEqual(imported.missing, []);
	for (const id of [ids.picture, ids.inner, ids.sound, ids.fragment]) assert.ok(await clean.has(id));

	const again = await importContainer(out.bytes, clean);
	assert.equal(again.added, 0);
	assert.equal(again.existing, 4);
});

test('exporting the same content twice gives the same bytes', async () => {
	const ids = await withAssets();
	const scene = worldScene(ids);
	const a = await exportContainer({ kind: 'world', name: 'W', scene }, ids.store);
	const b = await exportContainer({ kind: 'world', name: 'W', scene }, ids.store);
	assert.deepEqual(a.bytes, b.bytes);
});

test('assets this device cannot find are reported and left out, and are reported again on import', async () => {
	const ids = await withAssets();
	await ids.store.delete(ids.sound);
	const out = await exportContainer({ kind: 'world', name: 'W', scene: worldScene(ids) }, ids.store);
	assert.deepEqual(out.missing, [ids.sound]);
	const imported = await importContainer(out.bytes, new MemoryAssetStore());
	assert.deepEqual(imported.missing, [ids.sound]);
});

test('a resolver supplies assets the device lacks', async () => {
	const ids = await withAssets();
	const bytes = await ids.store.getBytes(ids.sound);
	await ids.store.delete(ids.sound);
	const resolver = { name: 'test', resolve: async (id) => (id === ids.sound ? bytes : null) };
	const out = await exportContainer({ kind: 'world', name: 'W', scene: worldScene(ids) }, ids.store, { resolvers: [resolver] });
	assert.deepEqual(out.missing, []);
});

test('objects and avatars keep their kind and extension', async () => {
	const store = new MemoryAssetStore();
	const tree = [slot('o', [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }])];
	assert.equal((await exportContainer({ kind: 'object', name: 'Crate', scene: tree }, store)).fileName, 'Crate.kin');
	const avatar = await exportContainer({ kind: 'avatar', name: '', scene: tree }, store);
	assert.equal(avatar.fileName, 'Avatar.kia');
	assert.equal((await readContainer(avatar.bytes)).manifest.kind, 'avatar');
});

test('a container whose asset does not match its address, or that is not one, is refused', async () => {
	const ids = await withAssets();
	const out = await exportContainer({ kind: 'world', name: 'W', scene: worldScene(ids) }, ids.store);
	const dir = readZipDirectory(out.bytes);
	const entries = [];
	for (const entry of dir) {
		let data = await readZipEntry(out.bytes, entry);
		if (entry.path === `assets/${ids.picture.slice(7)}.png`) data = png(9, 9); // a different picture under the same name
		entries.push({ path: entry.path, data });
	}
	await assert.rejects(readContainer(await writeZip(entries)), /content address/);
	await assert.rejects(readContainer(new TextEncoder().encode('{"hello":1}')), /not a Kithin file/);
	await assert.rejects(readContainer(await writeZip([{ path: 'x.txt', data: new Uint8Array(1) }])), /not a Kithin file/);
});

test('a world with an invalid scene is refused on import', async () => {
	const bad = [{ id: 'x' }];
	const bytes = await writeZip([
		{ path: 'kithin.json', data: new TextEncoder().encode(JSON.stringify({ format: 'kithin-container', version: 1, kind: 'world', name: 'W', assets: [] })) },
		{ path: 'scene.json', data: new TextEncoder().encode(JSON.stringify(bad)) }
	]);
	await assert.rejects(readContainer(bytes), /Invalid world slot/);
});

test('file names are safe', () => {
	assert.equal(containerFileName('../../etc/passwd', 'world'), 'etc passwd.kiw');
	assert.equal(containerFileName('   ', 'object'), 'Object.kin');
});
