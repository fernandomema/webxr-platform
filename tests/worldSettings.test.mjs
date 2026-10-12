import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { appInfoWithSettings, findWorldSettings } from '../src/lib/worlds/appManifest.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';
import { decode } from '../src/lib/lighting/format.ts';
import { nodeCodec } from '../src/lib/lighting/nodeCodec.ts';
import { runBake, BakeError } from '../src/lib/studio/lighting/bakeJob.ts';

// worlds/package.ts uses the app's `$lib` alias: load it with the alias pointed at the real files, as lightmapAsset.test.mjs does.
const libUrl = new URL('../src/lib/', import.meta.url);
const packageCode = ts.transpileModule(await readFile(new URL('worlds/package.ts', libUrl), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
const { validateWorldScene } = await import(`data:text/javascript;base64,${Buffer.from(packageCode).toString('base64')}`);

const slot = (id, components, extra = {}) => ({ id, name: id, parentId: null, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components, ...extra });
const ASSET = `sha256:${'a'.repeat(64)}`;

test('world settings are validated', () => {
	const scene = (settings) => [slot('root', [{ type: 'worldSettings', ...settings }])];
	validateWorldScene(scene({ description: 'A place', lighting: 'both', preview: { kind: 'asset', assetId: ASSET } }));
	assert.throws(() => validateWorldScene(scene({ description: 'x'.repeat(2001) })), /description/);
	assert.throws(() => validateWorldScene(scene({ lighting: 'dark' })), /lighting/);
	assert.throws(() => validateWorldScene(scene({ preview: { kind: 'url', url: 'https://x.test/a.png' } })), /preview/);
});

test('the preview is an asset of the world and the description feeds the app info', () => {
	const tree = [slot('root', [{ type: 'worldSettings', description: ' Hello ', preview: { kind: 'asset', assetId: ASSET } }])];
	assert.deepEqual([...collectAssetIds(tree)], [ASSET]);
	assert.equal(findWorldSettings(tree)?.description, ' Hello ');
	assert.equal(appInfoWithSettings(tree)?.description, 'Hello');
	const own = [slot('root', [{ type: 'appInfo', description: 'Own' }, { type: 'worldSettings', description: 'Other' }])];
	assert.equal(appInfoWithSettings(own)?.description, 'Own');
});

test('a studio bake makes a readable volume, and refuses a world without light', async () => {
	const room = (light) => [
		slot('floor', [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff' }], { scale: [6, 0.2, 6] }),
		...(light ? [slot('lamp', [{ type: 'pointLight', color: '#ffffff', intensity: 2, range: 10, baked: true }], { position: [0, 2, 0] })] : [])
	];
	await assert.rejects(runBake({ tree: room(false), quality: 'draft', skyIntensity: 0 }, () => {}), BakeError);
	let last = 0;
	const { bytes, stats } = await runBake({ tree: room(true), quality: 'draft', skyIntensity: 0 }, (f) => (last = f));
	assert.equal(stats.lights, 1);
	assert.equal(last, 1);
	// The browser deflates with the platform's streams; Node's zlib reads the same raw deflate.
	const { header } = decode(bytes, nodeCodec);
	assert.deepEqual(header.spec.dims, stats.dims);
});
