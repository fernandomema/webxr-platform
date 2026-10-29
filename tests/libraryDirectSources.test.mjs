import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { assertSourceContract } from './helpers/sourceContract.mjs';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { createGrab3dSource } = await import('../src/lib/server/library/sources/grab3d.ts');
const { createLazytexturesSource } = await import('../src/lib/server/library/sources/lazytextures.ts');
const { createFreeToUseSource } = await import('../src/lib/server/library/sources/freetouse.ts');

/** Answers by full address (query included); anything else is a 404. */
function withFixtures(fixtures, run) {
	return async () => {
		const original = globalThis.fetch;
		const calls = [];
		globalThis.fetch = async (url) => { calls.push(String(url)); return fixtures[String(url)] ? new Response(JSON.stringify(fixtures[String(url)])) : new Response('not found', { status: 404 }); };
		try { await run(calls); } finally { globalThis.fetch = original; }
	};
}

const glb = (slug, variant, bytes) => ({ format: 'glb', variant, bytes, url: `https://grab3d.com/dl/${slug}/${slug}${variant === 'light' ? '-light' : ''}.glb` });
const model = (slug, name, extra = {}) => ({
	slug, name: { en: name }, summary: `${name} model.`, category: 'creatures', categoryName: 'Fantasy & Creatures', tags: ['fantasy'], license: 'CC0-1.0',
	specs: { triangles: 50_000, maps: ['baseColor'] }, media: { thumbnailSmall: `https://grab3d.com/m/${slug}/thumb-400.webp` }, files: [glb(slug, 'full', 2_000_000), { format: 'fbx', variant: 'full', bytes: 1, url: `https://grab3d.com/dl/${slug}/x.fbx` }], ...extra
});
const grab3d = {
	'https://grab3d.com/api/v1/models.json': {
		models: [
			model('crystal-dragon', 'Crystal Dragon', { specs: { triangles: 800_000, trianglesLight: 40_000, texturePx: 4096, texturePxLight: 1024 }, files: [glb('crystal-dragon', 'full', 31_000_000), glb('crystal-dragon', 'light', 4_000_000)] }),
			model('oak-table', 'Oak Table', { category: 'furniture', categoryName: 'Furniture', tags: ['table', 'wood'] }),
			model('paid-thing', 'Paid Thing', { license: 'LicenseRef-Other' })
		]
	}
};

test('Grab3D follows the source contract, searches the cached catalog and only offers CC0 GLBs', withFixtures(grab3d, async (calls) => {
	const source = createGrab3dSource();
	await assertSourceContract(source, { queries: [{ kind: 'model', text: 'dragon' }] });
	const everything = await source.search({ text: '', kind: 'model', limit: 1 });
	assert.equal(everything.total, 2, 'the model that is not CC0 is left out');
	assert.equal(everything.next, '1');
	assert.equal((await source.search({ text: '', kind: 'model', limit: 1, cursor: '1' })).next, null);
	assert.deepEqual((await source.search({ text: 'wood', kind: 'model' })).items.map((item) => item.ref), ['grab3d:oak-table']);
	assert.deepEqual((await source.search({ text: '', kind: 'model', filters: { category: 'furniture' } })).items.map((item) => item.ref), ['grab3d:oak-table']);
	assert.equal(calls.length, 1, 'the catalog is fetched once');
	await assert.rejects(source.search({ text: '', kind: 'audio' }), (error) => error.status === 400);
	await assert.rejects(source.detail('missing'), (error) => error.status === 404);
}));

test('a Grab3D model offers its light GLB first and flags a full one over the polygon budget', withFixtures(grab3d, async () => {
	const dragon = await createGrab3dSource().detail('crystal-dragon');
	assert.deepEqual(dragon.variants.map((variant) => [variant.id, Boolean(variant.unsupported)]), [['glb-light', false], ['glb-full', true]]);
	assert.match(dragon.variants[1].unsupported, /polygons/);
	assert.equal(dragon.license.commercialUse, true);
	assert.equal(dragon.facts.polyCount, 40_000);
}));

const lazyRow = (category, name) => ({ name, category, type: 'material', basePath: `/Assets/Materials/${category}/${name}`, preview: { path: `/Assets/Materials/${category}/${name}/Preview.png` }, tags: [name, category, 'Wall'] });
const tex = (resolution, name, type, ext = 'png') => ({ name: `Brick01_${name}.${ext}`, type, path: `/Assets/Materials/Stone/Brick01/Mat/${resolution}/Brick01_${name}.${ext}` });
const lazy = {
	'https://lazytextures.net/materials/Search?limit=2&offset=0&q=brick': { success: true, results: [lazyRow('Stone', 'Brick01')], pagination: { total: 3, hasMore: true, nextOffset: 2 } },
	'https://lazytextures.net/previews-paginated/materials?limit=24&offset=0&sort=downloads-desc': { success: true, data: [lazyRow('Stone', 'Brick01'), lazyRow('Wood', 'Oak_Planks')], pagination: { total: 2, hasMore: false } },
	'https://lazytextures.net/Assets/Materials/Stone/Brick01/Infos.json': {
		textures: {
			'8k': [tex('8k', 'Color', 'Color')],
			'1k': [tex('1k', 'Color', 'Color'), tex('1k', 'normal', 'normal'), tex('1k', 'roughness', 'roughness'), tex('1k', 'Displacement', 'Displacement', 'exr'), { name: 'Preview.png', type: 'Preview', path: '/Assets/Materials/Stone/Brick01/Preview.png' }]
		}
	}
};

test('Lazytextures follows the source contract and builds each resolution from the maps it really has', withFixtures(lazy, async () => {
	const source = createLazytexturesSource();
	await assertSourceContract(source, { queries: [{ kind: 'material', text: 'brick' }] });
	const brick = await source.detail('Stone~Brick01');
	assert.deepEqual(brick.variants.map((variant) => variant.id), ['1k', '8k']);
	assert.deepEqual(brick.variants[0].files.map((file) => file.role), ['albedo', 'normal', 'roughness']);
	assert.equal(brick.variants[0].files[0].url, 'https://lazytextures.net/Assets/Materials/Stone/Brick01/Mat/1k/Brick01_Color.png');
	assert.equal(brick.variants[0].unsupported, undefined);
	assert.match(brick.variants[1].unsupported, /too large/);
	assert.equal(brick.license.commercialUse, true);
}));

test('Lazytextures lists by downloads without a query, pages, and refuses ids that are not an asset', withFixtures(lazy, async () => {
	const source = createLazytexturesSource();
	const popular = await source.search({ text: '', kind: 'material' });
	assert.equal(popular.items.length, 2);
	assert.equal(popular.next, null);
	assert.equal((await source.search({ text: 'brick', kind: 'material', limit: 2 })).next, '2');
	await assert.rejects(source.search({ text: '', kind: 'model' }), (error) => error.status === 400);
	await assert.rejects(source.detail('../../etc~passwd'), (error) => error.status === 404);
	await assert.rejects(source.detail('NoCategory'), (error) => error.status === 404);
	await assert.rejects(source.detail('Stone~Missing'), (error) => error.status === 404);
}));

const track = (id, title, extra = {}) => ({
	id, title, genre: 'Easy Listening', artists: [[0, { id: 'a', name: 'Johny Grimes' }]], categories: [[1, { id: 'c', name: 'Chill' }]], tags: [[0, 'nostalgic']],
	thumbnails: { md: `https://eu.data.freetouse.com/music/tracks/${id}/cover.webp` }, files: { mp3: `https://eu.data.freetouse.com/music/tracks/${id}/file/mp3/file.mp3` }, is_premium: false, ...extra
});
const freetouse = {
	'https://api.freetouse.com/v3/music/tracks/search?limit=2&offset=0&query=chill': { ok: true, data: [track('t1', 'Akaneiro'), track('t2', 'Locked', { is_premium: true })], pagination: { limit: 2, offset: 0, count: 5 } },
	'https://api.freetouse.com/v3/music/tracks/all?limit=24&offset=0': { ok: true, data: [track('t1', 'Akaneiro')], pagination: { limit: 24, offset: 0, count: 1 } },
	'https://api.freetouse.com/v3/music/tracks/t1': { ok: true, data: track('t1', 'Akaneiro') }
};

test('Free To Use follows the source contract, skips premium tracks and does not claim commercial use', withFixtures(freetouse, async () => {
	const source = createFreeToUseSource();
	await assertSourceContract(source, { queries: [{ kind: 'audio', text: 'chill' }] });
	const found = await source.search({ text: 'chill', kind: 'audio', limit: 2 });
	assert.deepEqual(found.items.map((item) => item.title), ['Akaneiro'], 'a premium track is not offered');
	assert.equal(found.next, '2');
	assert.equal(found.total, 5);
	assert.equal(found.items[0].author, 'Johny Grimes');
	assert.equal(found.items[0].license.commercialUse, 'unknown');
	assert.equal(found.items[0].license.attributionRequired, true);
	assert.equal((await source.search({ text: '', kind: 'audio' })).next, null);
	const detail = await source.detail('t1');
	assert.deepEqual([detail.variants[0].format, detail.variants[0].files[0].role], ['mp3', 'audio']);
	assert.ok(new URL(detail.variants[0].files[0].url).hostname.endsWith('.freetouse.com'));
	await assert.rejects(source.detail('t9'), (error) => error.status === 404);
	await assert.rejects(source.detail('a/b'), (error) => error.status === 404);
	await assert.rejects(source.search({ text: '', kind: 'model' }), (error) => error.status === 400);
}));
