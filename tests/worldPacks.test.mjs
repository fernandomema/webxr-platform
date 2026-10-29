import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { MemoryAssetStore } from '../packages/engine/src/assets/store.ts';
import { importContainer } from '../packages/engine/src/container/kithinFile.ts';
import { listPackIds, packAssetUrl, renderAssetsModule, resolvePackRequest, scanPackAssets, syncPackAssets } from '../src/lib/worldPacks/core.ts';
import { exportPack } from '../src/lib/worldPacks/export.ts';

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const text = (s) => [...s].map((c) => c.charCodeAt(0));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(8), ...be32(8), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const idOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function makePack() {
	const root = mkdtempSync(join(tmpdir(), 'packs-'));
	const dir = join(root, 'my-world');
	mkdirSync(join(dir, 'assets', 'pictures'), { recursive: true });
	writeFileSync(join(dir, 'world.ts'), '');
	writeFileSync(join(dir, 'assets', 'pictures', 'wall one.png'), png);
	writeFileSync(join(dir, 'assets', '.hidden'), 'x');
	mkdirSync(join(root, 'Not-A-Pack'));
	writeFileSync(join(root, 'Not-A-Pack', 'world.ts'), '');
	mkdirSync(join(root, 'no-world'));
	return { root, dir };
}

test('packs are the folders with a valid id and a world.ts', () => {
	const { root } = makePack();
	assert.deepEqual(listPackIds(root), ['my-world']);
	assert.deepEqual(listPackIds(join(root, 'missing')), []);
	rmSync(root, { recursive: true });
});

test('asset ids are the content hash and assets.ts is typed and only rewritten when something changed', () => {
	const { root, dir } = makePack();
	assert.deepEqual(scanPackAssets(dir), { 'pictures/wall one.png': idOf(png) });
	assert.equal(syncPackAssets(dir).changed, true);
	assert.equal(syncPackAssets(dir).changed, false);
	const source = readFileSync(join(dir, 'assets.ts'), 'utf8');
	assert.equal(source, renderAssetsModule({ 'pictures/wall one.png': idOf(png) }));
	assert.match(source, /"pictures\/wall one\.png": "sha256:[0-9a-f]{64}"/);
	assert.equal(packAssetUrl('my-world', 'pictures/wall one.png'), '/@packs/my-world/assets/pictures/wall%20one.png');
	rmSync(root, { recursive: true });
});

test('the dev server only serves files inside a pack\'s assets folder', () => {
	const { root, dir } = makePack();
	writeFileSync(join(dir, 'secret.txt'), 'no');
	assert.equal(resolvePackRequest(root, '/my-world/assets/pictures/wall%20one.png?x=1'), join(dir, 'assets', 'pictures', 'wall one.png'));
	for (const url of ['/my-world/assets/../secret.txt', '/my-world/assets/%2e%2e/secret.txt', '/my-world/secret.txt', '/my-world/assets/pictures', '/My-World/assets/a', '/my-world/assets/%zz', '/my-world']) {
		assert.equal(resolvePackRequest(root, url), null, url);
	}
	rmSync(root, { recursive: true });
});

test('a pack exports as a Kithin file carrying the assets its scene uses', async () => {
	const { root, dir } = makePack();
	const wall = idOf(png);
	const world = { name: 'My world', description: '', build: () => [createSlot({ id: 'wall', name: 'Wall', components: [{ type: 'material', albedo: { kind: 'asset', assetId: wall } }] })] };
	const result = await exportPack(dir, world);
	assert.equal(result.assetCount, 1);
	assert.deepEqual(result.missing, []);
	const store = new MemoryAssetStore();
	const imported = await importContainer(result.bytes, store);
	assert.equal(imported.name, 'My world');
	assert.equal(await store.has(wall), true);

	const lost = await exportPack(dir, { ...world, build: () => [createSlot({ id: 'x', name: 'X', components: [{ type: 'material', albedo: { kind: 'asset', assetId: `sha256:${'0'.repeat(64)}` } }] })] });
	assert.equal(lost.missing.length, 1);
	rmSync(root, { recursive: true });
});

test('a pack publishes like the Studio does: files first, then the world, as the account of the cookie', async () => {
	const { publishPack, whoami, PublishError, normalizeHost } = await import('../src/lib/worldPacks/publish.ts');
	const { readCookie, saveCookie, readPublishedId, savePublishedId } = await import('../src/lib/worldPacks/core.ts');
	const { root, dir } = makePack();
	const wall = idOf(png);
	const world = { name: 'My world', description: '', build: () => [createSlot({ id: 'wall', name: 'Wall', components: [{ type: 'material', albedo: { kind: 'asset', assetId: wall } }] })] };

	const calls = [];
	let signedIn = true;
	let known = false;
	const fake = async (url, init = {}) => {
		const path = new URL(url).pathname;
		calls.push({ path, cookie: init.headers?.cookie, body: init.body });
		const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
		if (path === '/api/auth/get-session') return reply(signedIn ? { user: { id: 'u1', name: 'Ana', email: 'ana@example.com' } } : null);
		if (path === '/api/assets/uploads') return reply(known ? { exists: true } : { exists: false, upload: { method: 'PUT', url: '/storage/put', headers: { 'x-a': 'b' } } });
		if (path === '/storage/put') return new Response(null, { status: 200 });
		if (path === '/api/assets/uploads/complete') return reply({ ok: true });
		if (path === '/api/published-worlds') return reply({ id: 'w1', name: 'My world', latestRevision: 1 }, 201);
		if (path === '/api/published-worlds/w1/revisions') return reply({ id: 'r2', number: 2 }, 201);
		return reply({ message: 'nope' }, 404);
	};
	const target = { host: 'example.com/ignored', cookie: 'session=abc', fetch: fake };
	assert.equal(normalizeHost('example.com/x'), 'https://example.com');
	assert.equal((await whoami(target)).email, 'ana@example.com');

	const first = await publishPack(dir, world, target);
	assert.deepEqual([first.id, first.revision, first.created, first.uploaded, first.existing], ['w1', 1, true, 1, 0]);
	assert.deepEqual(calls.map((call) => call.path).filter((path) => path !== '/api/auth/get-session'), ['/api/assets/uploads', '/storage/put', '/api/assets/uploads/complete', '/api/published-worlds']);
	assert.ok(calls.every((call) => call.cookie === 'session=abc'), 'every call to the platform carries the cookie');

	known = true;
	const next = await publishPack(dir, world, target, { publishedId: 'w1' });
	assert.deepEqual([next.id, next.revision, next.created, next.uploaded, next.existing], ['w1', 2, false, 0, 1]);

	signedIn = false;
	await assert.rejects(publishPack(dir, world, target), (error) => error instanceof PublishError && error.status === 401);

	assert.equal(readCookie(root, 'https://example.com', {}), null);
	saveCookie(root, 'https://example.com', 'session=abc');
	assert.equal(readCookie(root, 'https://example.com', {}), 'session=abc');
	assert.equal(readCookie(root, 'https://example.com', { KITHIN_COOKIE: 'other' }), 'other');
	savePublishedId(dir, 'https://example.com', 'w1');
	assert.equal(readPublishedId(dir, 'https://example.com'), 'w1');
	assert.equal(readPublishedId(dir, 'https://elsewhere.com'), null);
	rmSync(root, { recursive: true });
});

test('baked lighting becomes a lightVolume for each region that has a file', async () => {
	const { lightVolumeSlots, bakedLightingPath } = await import('../src/lib/worldPacks/lighting.ts');
	const id = `sha256:${'a'.repeat(64)}`;
	const regions = [{ id: 'hall', min: [0, 0, 0], max: [1, 1, 1], voxel: 0.5 }, { id: 'yard', min: [0, 0, 0], max: [1, 1, 1], voxel: 0.5 }];
	const slots = lightVolumeSlots({ [bakedLightingPath('hall')]: id }, regions);
	assert.equal(slots.length, 1);
	assert.deepEqual(slots[0].components[0], { type: 'lightVolume', data: { kind: 'asset', assetId: id } });
});
