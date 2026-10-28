import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getPlatformConfig, configurePlatform } from '../packages/engine/src/xr/platform/config.ts';
import { getFeatures, resetFeatures } from '../packages/engine/src/xr/features.ts';
import { registerContent } from '../packages/engine/src/xr/content/registry.ts';
import { startGame } from '../packages/game/src/runtime.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	configurePlatform({ apiBase: '', appId: null, name: 'Kithin', getToken: null, setToken: null });
	resetFeatures();
	registerContent({ bundledAssets: {}, loadWorlds: undefined, loadHome: undefined });
});

/** A site that serves a bundle of two worlds. */
function serveBundle(home) {
	const manifest = { formatVersion: 1, assets: {}, home, worlds: [{ id: 'one', name: 'One', url: 'worlds/one.json' }, { id: 'two', name: 'Two', url: 'worlds/two.json' }] };
	globalThis.fetch = async (url) => {
		const path = new URL(url).pathname;
		const body = path === '/content/bundle.json' ? manifest : { formatVersion: 1, name: path, scene: [] };
		return new Response(JSON.stringify(body));
	};
}

test('a game that only names itself gets Kithin’s defaults, a token of its own and no worlds tab', () => {
	startGame({ name: 'ROUNDS VR' }, {});
	const platform = getPlatformConfig();
	assert.equal(platform.name, 'ROUNDS VR');
	assert.equal(platform.apiBase, 'https://localhost:5173');
	assert.equal(platform.appId, null);
	assert.ok(platform.setToken, 'signing in with a code is on');
	assert.equal(getFeatures().worldsTab, false);
	assert.equal(getFeatures().inspector, false);
	assert.equal(getFeatures().inventoryTab, true);
});

test('the environment and the game’s own settings decide where Kithin is, in that order', () => {
	startGame({ name: 'A' }, { VITE_KITHIN_URL: 'https://kithin.example/', VITE_KITHIN_APP_ID: 'app-1' });
	assert.equal(getPlatformConfig().apiBase, 'https://kithin.example');
	assert.equal(getPlatformConfig().appId, 'app-1');
	startGame({ name: 'A', kithinUrl: 'https://other.example', appId: 'app-2', platform: { signalingUrl: 'wss://s.example' }, features: { worldsTab: true } }, { VITE_KITHIN_URL: 'https://kithin.example', VITE_KITHIN_APP_ID: 'app-1' });
	assert.equal(getPlatformConfig().apiBase, 'https://other.example');
	assert.equal(getPlatformConfig().appId, 'app-2');
	assert.equal(getPlatformConfig().signalingUrl, 'wss://s.example');
	assert.equal(getFeatures().worldsTab, true);
});

test('the first world of the bundle is the one to play, unless the game names another', async () => {
	serveBundle('one');
	assert.equal((await startGame({ name: 'G' }, {}).loadWorld()).name, '/content/worlds/one.json');
	assert.equal((await startGame({ name: 'G', world: 'two' }, {}).loadWorld()).name, '/content/worlds/two.json');
});

test('a game keeps only its files: the page, the routes and the tooling are the package’s', () => {
	for (const game of ['standalone-game', 'rounds-vr']) {
		const root = new URL(`../examples/${game}/`, import.meta.url).pathname;
		for (const generic of ['svelte.config.js', 'vite.config.ts', 'src/app.html', 'src/routes']) assert.equal(existsSync(root + generic), false, `${game} has its own ${generic}`);
		assert.ok(existsSync(root + 'src/game.ts'));
	}
});

test('the engine’s static files are served from its package and nothing outside it', async () => {
	const { engineStaticFile, engineStatic } = await import('../packages/game/engineStatic.mjs');
	assert.ok(engineStaticFile('/draco/draco_decoder.wasm?v=1'));
	assert.equal(engineStaticFile('/nothing-here.js'), null);
	assert.equal(engineStaticFile('/../package.json'), null);
	assert.equal(engineStaticFile('/%2e%2e/package.json'), null);
	// A file of the game's own with the same address wins.
	const served = [];
	const middleware = [];
	engineStatic(new URL('../packages/engine/static', import.meta.url).pathname).configureServer({ middlewares: { use: (fn) => middleware.push(fn) } });
	middleware[0]({ url: '/draco/draco_decoder.wasm' }, {}, () => served.push('game'));
	assert.deepEqual(served, ['game']);
});
