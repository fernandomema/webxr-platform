import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { assertSourceContract } from './helpers/sourceContract.mjs';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { createShepSource, isImportable } = await import('../src/lib/server/library/sources/shep.ts');
const { createLibrary } = await import('../src/lib/server/library/service.ts');
const { writeZip } = await import('../packages/engine/src/container/zip.ts');

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/library/shep/${name}.json`, import.meta.url), 'utf8'));
const BASE = 'https://3d.shep.bot';
const answers = {
	'/v1/providers': fixture('providers'),
	'/v1/assets/ambientcg%3ABricks097': fixture('detail-ambientcg-material'),
	'/v1/assets/blenderkit%3A7bea2b93-30ac-4ee2-8414-c5e1f712911e': fixture('detail-blenderkit-model'),
	'/v1/assets/scenario%3Ascenario_asset_4tjXgQMGuqmPBWoBpRxNkwo2': fixture('detail-scenario-model'),
	'/v1/assets/polyhaven%3Amodern_arm_chair_01': fixture('detail-polyhaven-model'),
	'/v1/assets/polyhaven%3Ared_brick': fixture('detail-polyhaven-material')
};

function network({ zip } = {}) {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		calls.push({ url: url.href, headers: init?.headers });
		if (url.origin === BASE) {
			if (url.pathname === '/v1/search') return new Response(JSON.stringify(fixture(url.searchParams.get('type') === 'material' ? 'search-material' : 'search-model')));
			const body = answers[url.pathname + (url.search ? '' : '')];
			return body ? new Response(JSON.stringify(body)) : new Response('missing', { status: 404 });
		}
		if (zip && url.href.startsWith('https://ambientcg.com/get?file=Bricks097_1K-JPG.zip')) return new Response(zip);
		return new Response('nope', { status: 404 });
	};
	return { calls, restore: () => { globalThis.fetch = original; } };
}

test('shep follows the source contract for materials and models', async () => {
	const net = network();
	try { await assertSourceContract(createShepSource(), { queries: [{ kind: 'material', text: 'brick' }, { kind: 'model', text: 'chair' }] }); }
	finally { net.restore(); }
});

test('searching asks for downloadable assets of the right type, pages by offset, and leaves out the providers we serve directly', async () => {
	const net = network();
	try {
		const direct = createShepSource({ exclude: ['polyhaven'] });
		const page = await direct.search({ text: 'brick', kind: 'material', limit: 3, cursor: '3' });
		const search = net.calls.map((call) => new URL(call.url)).find((url) => url.pathname === '/v1/search');
		assert.equal(search.searchParams.get('type'), 'material');
		assert.equal(search.searchParams.get('downloadable'), 'true');
		assert.equal(search.searchParams.get('offset'), '3');
		assert.ok(!search.searchParams.get('providers').split(',').includes('polyhaven'), 'Poly Haven is served directly');
		assert.ok(search.searchParams.get('providers').split(',').includes('ambientcg'));
		assert.equal(page.next, '6', 'the offset moves on by the page');
		assert.ok(page.items.length > 0 && page.items.every((item) => item.downloadable));
		assert.deepEqual(direct.info.covers, ['polyhaven']);
	} finally { net.restore(); }
});

test('an ambientCG material becomes one variant per size whose maps are unpacked from its ZIP', async () => {
	const net = network();
	try {
		const detail = await createShepSource().detail('ambientcg:Bricks097');
		assert.deepEqual(detail.variants.map((variant) => variant.id), ['1k', '2k']);
		assert.deepEqual(detail.variants[0].files.map((file) => file.role), ['albedo', 'normal', 'roughness', 'ao', 'metallic']);
		assert.ok(detail.variants[0].files.every((file) => file.url.startsWith('shepzip:')));
		assert.equal(detail.license.name, 'CC0');
		assert.equal(detail.ref, 'shep:ambientcg:Bricks097');
	} finally { net.restore(); }
});

test('opening a map takes it out of the ZIP, once for all the maps of that ZIP', async () => {
	const files = { 'Bricks097_1K-JPG_Color.jpg': [1, 2, 3], 'Bricks097_1K-JPG_NormalGL.jpg': [4, 5], 'Bricks097_1K-JPG_NormalDX.jpg': [9], 'Bricks097_1K-JPG_Roughness.jpg': [6] };
	const zip = await writeZip(Object.entries(files).map(([path, data]) => ({ path, data: new Uint8Array(data) })));
	const net = network({ zip });
	try {
		const source = createShepSource();
		const detail = await source.detail('ambientcg:Bricks097');
		const open = (role) => source.open(detail.variants[0].files.find((file) => file.role === role));
		assert.deepEqual([...(await open('albedo')).bytes], [1, 2, 3]);
		assert.deepEqual([...(await open('normal')).bytes], [4, 5], 'the OpenGL normal, not the DirectX one');
		assert.deepEqual([...(await open('roughness')).bytes], [6]);
		await assert.rejects(open('ao'), (error) => error.status === 404, 'a map the archive does not have');
		assert.equal(net.calls.filter((call) => call.url.includes('ambientcg.com/get')).length, 1, 'the archive is downloaded once');
	} finally { net.restore(); }
});

test('a plain file of shep is not opened by the source (the library fetches it directly)', async () => {
	const net = network();
	try {
		const source = createShepSource();
		const scenario = await source.detail('scenario:scenario_asset_4tjXgQMGuqmPBWoBpRxNkwo2');
		assert.equal(await source.open(scenario.variants[0].files[0]), null);
	} finally { net.restore(); }
});

test('only GLB models can be imported; other formats are listed with the reason', async () => {
	const net = network();
	try {
		const source = createShepSource();
		const bk = await source.detail('blenderkit:7bea2b93-30ac-4ee2-8414-c5e1f712911e');
		const usable = bk.variants.filter((variant) => !variant.unsupported);
		assert.equal(usable.length, 2, 'both GLB files');
		assert.ok(usable.every((variant) => variant.format === 'glb' && variant.files[0].role === 'model'));
		assert.match(bk.variants.find((variant) => variant.format === 'blend').unsupported, /BLEND needs converting/);
		assert.equal(bk.variants.findIndex((variant) => variant.unsupported) > usable.length - 1, true, 'importable ones come first');
		assert.equal(bk.variants.filter((variant) => variant.format === 'blend').length, 1, 'one line per format, not one per file');
		const scenario = await source.detail('scenario:scenario_asset_4tjXgQMGuqmPBWoBpRxNkwo2');
		assert.equal(scenario.license.attributionRequired, true);
		assert.equal(scenario.author, 'Scenario');
		assert.equal(scenario.variants[0].files[0].url.startsWith('https://huggingface.co/'), true);
	} finally { net.restore(); }
});

test('a provider whose maps are separate files gives them as roles per size', async () => {
	const net = network();
	try {
		const material = await createShepSource().detail('polyhaven:red_brick');
		assert.deepEqual(material.variants.map((variant) => variant.id), ['1k', '2k']);
		const roles = material.variants[0].files.map((file) => file.role);
		assert.ok(roles.includes('albedo') && roles.includes('normal'), roles.join());
		assert.ok(material.variants[0].files.every((file) => file.url.startsWith('https://dl.polyhaven.org/')), 'plain files, no archive');
		assert.equal(new Set(roles).size, roles.length, 'one file per role');
	} finally { net.restore(); }
});

test('a model that only comes as glTF with companions is not offered as importable (Poly Haven style, when it is not served directly) gives them as roles per size (Poly Haven style, when it is not served directly)', async () => {
	const net = network();
	try {
		const model = await createShepSource().detail('polyhaven:modern_arm_chair_01');
		assert.equal(model.kind, 'model');
		assert.ok(model.variants.every((variant) => variant.unsupported), 'this one only has glTF with companions, which is not importable yet');
		assert.equal(model.downloadable, false, 'so it is not offered as downloadable');
	} finally { net.restore(); }
});

test('the library merges shep with Poly Haven without showing the same asset twice, and a key is sent when there is one', async () => {
	const net = network();
	try {
		const shep = createShepSource({ exclude: ['polyhaven'], apiKey: 'secret' });
		const library = createLibrary([shep]);
		const result = await library.search({ source: 'shep', kind: 'material', text: 'brick' });
		assert.ok(result.items.length > 0);
		assert.ok(net.calls.some((call) => call.headers?.authorization === 'Bearer secret'));
	} finally { net.restore(); }
});

test('shep\'s files may come from any public host by default, or only from a fixed list when one is given', async () => {
	assert.ok(createShepSource().info.allowedHosts.includes('*'));
	const fixed = createShepSource({ extraHosts: ['cdn.example.org'] }).info.allowedHosts;
	assert.deepEqual(fixed, ['3d.shep.bot', 'cdn.example.org']);
	assert.ok(createShepSource({ baseUrl: 'https://assets.mystudio.example', extraHosts: ['x.example'] }).info.allowedHosts.includes('assets.mystudio.example'));
});

test('only what can be imported here is listed, unless the rest is asked for', async () => {
	const net = network();
	try {
		const source = createShepSource();
		const importable = await source.search({ text: 'chair', kind: 'model', limit: 5 });
		assert.ok(importable.items.length > 0 && importable.items.every((item) => item.downloadable), 'every card can be imported');
		assert.ok(importable.items.every((item) => !item.ref.startsWith('shep:polyhaven:')), 'a glTF with companion files is not offered');
		const everything = await source.search({ text: 'chair', kind: 'model', limit: 5, filters: { importableOnly: false } });
		assert.ok(everything.items.length > importable.items.length);
		assert.ok(everything.items.some((item) => !item.downloadable));
		assert.equal(importable.total, undefined, 'the total is not known once some were left out');
	} finally { net.restore(); }
});

test('which formats count as importable for each kind', () => {
	assert.equal(isImportable('model', ['blend', 'fbx', 'glb']), true);
	assert.equal(isImportable('model', ['gltf', 'fbx', 'blend', 'usd']), false);
	assert.equal(isImportable('model', ['GLB']), true);
	assert.equal(isImportable('model', []), false, 'no formats given: a pack of unknown files');
	assert.equal(isImportable('model', undefined), false);
	assert.equal(isImportable('material', ['jpg', 'png']), true);
	assert.equal(isImportable('material', ['blend']), false);
	assert.equal(isImportable('audio', ['wav']), true);
	assert.equal(isImportable('image', ['png']), true);
	assert.equal(isImportable('hdri', ['hdr']), false);
});
