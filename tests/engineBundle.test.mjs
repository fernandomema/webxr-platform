import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBundle } from '../packages/engine/src/xr/content/bundle.ts';
import { getContent, loadBuiltinWorlds, registerContent } from '../packages/engine/src/xr/content/registry.ts';
import { bundledAssetResolver } from '../packages/engine/src/assets/builtin.ts';

const cli = new URL('../packages/engine/bin/bundle.mjs', import.meta.url).pathname;
const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function gameFolder() {
	const folder = mkdtempSync(join(tmpdir(), 'bundle-'));
	mkdirSync(join(folder, 'worlds'));
	mkdirSync(join(folder, 'models'));
	writeFileSync(join(folder, 'models', 'rock.glb'), Buffer.from('glTF fake model'));
	writeFileSync(join(folder, 'worlds', 'level-1.json'), JSON.stringify({ formatVersion: 1, name: 'Level 1', description: 'The first one', defaultVisibility: 'solo', scene: [{ id: 'floor' }] }));
	writeFileSync(join(folder, 'worlds', 'level-2.json'), JSON.stringify({ formatVersion: 1, name: 'Level 2', defaultVisibility: 'solo', scene: [{ id: 'floor2' }] }));
	return folder;
}

afterEach(() => registerContent({ bundledAssets: {}, loadWorlds: undefined, loadHome: undefined }));

test('the bundle tool lists the worlds and finds every other file by the hash of its bytes', () => {
	const folder = gameFolder();
	execFileSync('node', [cli, folder]);
	const manifest = JSON.parse(readFileSync(join(folder, 'bundle.json'), 'utf8'));
	assert.equal(manifest.assets[sha(Buffer.from('glTF fake model'))], 'models/rock.glb');
	assert.deepEqual(manifest.worlds.map((world) => [world.id, world.name, world.url]), [['level-1', 'Level 1', 'worlds/level-1.json'], ['level-2', 'Level 2', 'worlds/level-2.json']]);
	assert.equal(manifest.home, 'level-1');
	assert.equal(Object.keys(manifest.assets).length, 1, 'worlds are not assets, and the bundle does not list itself');
	assert.deepEqual(manifest.names, { 'models/rock.glb': sha(Buffer.from('glTF fake model')) }, 'files can be named by their path');
	execFileSync('node', [cli, folder]); // again: the first bundle.json is not taken for an asset
	assert.equal(Object.keys(JSON.parse(readFileSync(join(folder, 'bundle.json'), 'utf8')).assets).length, 1);
});

test('a bundle makes its files findable by hash and its worlds the built-in worlds, loading each only when needed', async () => {
	const folder = gameFolder();
	execFileSync('node', [cli, folder]);
	const files = new Map([['https://game.test/content/bundle.json', readFileSync(join(folder, 'bundle.json'))], ['https://game.test/content/models/rock.glb', Buffer.from('glTF fake model')], ['https://game.test/content/worlds/level-1.json', readFileSync(join(folder, 'worlds/level-1.json'))], ['https://game.test/content/worlds/level-2.json', readFileSync(join(folder, 'worlds/level-2.json'))]]);
	const requested = [];
	const fetchFn = async (url) => {
		requested.push(String(url));
		const bytes = files.get(String(url));
		return bytes ? new Response(bytes) : new Response('', { status: 404 });
	};
	const bundle = await loadBundle('https://game.test/content/bundle.json', fetchFn);
	assert.deepEqual(requested, ['https://game.test/content/bundle.json'], 'nothing else is fetched up front');

	assert.equal(getContent().bundledAssets[sha(Buffer.from('glTF fake model'))], 'https://game.test/content/models/rock.glb');
	const { worlds, devWorldIds } = await loadBuiltinWorlds();
	assert.deepEqual(worlds.map((world) => [world.id, world.name, world.description]), [['level-1', 'Level 1', 'The first one'], ['level-2', 'Level 2', '']]);
	assert.deepEqual(devWorldIds, []);
	assert.deepEqual(await getContent().loadHome(), [{ id: 'floor' }]);
	assert.equal((await bundle.world('level-2')).name, 'Level 2');
	assert.equal(bundle.assetId('models/rock.glb'), sha(Buffer.from('glTF fake model')));
	assert.equal(bundle.assetId('models/none.glb'), undefined);
	await assert.rejects(bundle.world('nope'), /no world/);

	const realFetch = globalThis.fetch;
	globalThis.fetch = fetchFn;
	try {
		const bytes = await bundledAssetResolver.resolve(sha(Buffer.from('glTF fake model')), new AbortController().signal);
		assert.equal(Buffer.from(bytes).toString(), 'glTF fake model');
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('something that is not a bundle, or is missing, is refused', async () => {
	await assert.rejects(loadBundle('https://game.test/x.json', async () => Response.json({ hello: 1 })), /not a content bundle/);
	await assert.rejects(loadBundle('https://game.test/x.json', async () => new Response('', { status: 404 })), /404/);
});
