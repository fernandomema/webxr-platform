import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { assertSourceContract } from './helpers/sourceContract.mjs';

const libRoot = new URL('../src/lib/', import.meta.url);
registerHooks({
	resolve(specifier, context, nextResolve) {
		const target = specifier.startsWith('$lib/') ? new URL(specifier.slice(5), libRoot).href : specifier;
		const resolved = (target.startsWith('.') || target.startsWith('file:')) && !/\.(ts|js|mjs|json)$/.test(target) ? `${target}.ts` : target;
		return nextResolve(resolved, context);
	}
});

const at = (res, ext, name) => ({ url: `https://dl.polyhaven.org/file/ph-assets/Textures/${ext}/${res}/brick_wall_002/${name}.${ext}`, size: 120_000 });
const fixtures = {
	'https://api.polyhaven.com/assets?type=models': { WoodenChair_01: { name: 'Wooden Chair 01', description: 'A chair.', category: 'furniture', tags: ['chair', 'wood'], thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/WoodenChair_01.png', polycount: 5000, type: 2 }, Oak_Table: { name: 'Oak Table', category: 'furniture', tags: ['table'], thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/Oak_Table.png', polycount: 8000, type: 2 }, Huge_Statue: { name: 'Huge Statue', polycount: 900_000, type: 2, tags: [] } },
	'https://api.polyhaven.com/assets?type=textures': { brick_wall_002: { name: 'Brick Wall 002', categories: ['brick'], dimensions: [2000, 2000], download_count: 10, thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/brick_wall_002.png' } },
	'https://api.polyhaven.com/search?q=brick&t=textures': { results: [{ slug: 'brick_wall_002' }] },
	'https://api.polyhaven.com/files/brick_wall_002': { Diffuse: { '1k': { jpg: at('1k', 'jpg', 'diff') }, '2k': { jpg: at('2k', 'jpg', 'diff') } }, nor_gl: { '1k': { png: at('1k', 'png', 'nor') } }, arm: { '1k': { jpg: at('1k', 'jpg', 'arm') } } }
};

function withFixtures(run) {
	return async () => {
		const original = globalThis.fetch;
		globalThis.fetch = async (url) => (fixtures[String(url)] ? new Response(JSON.stringify(fixtures[String(url)])) : new Response('not found', { status: 404 }));
		try { await run(); } finally { globalThis.fetch = original; }
	};
}

const { polyHavenSource } = await import('../src/lib/server/library/sources/polyhaven.ts');

test('Poly Haven follows the source contract for models and for materials', withFixtures(async () => {
	await assertSourceContract(polyHavenSource, { queries: [{ kind: 'model', text: 'chair' }, { kind: 'material', text: 'brick' }] });
}));

test('a model is one GLB variant that Poly Haven\'s source assembles itself, and a model with too many polygons is flagged', withFixtures(async () => {
	const chair = await polyHavenSource.detail('WoodenChair_01');
	assert.equal(chair.variants.length, 1);
	assert.deepEqual([chair.variants[0].format, chair.variants[0].files[0].role], ['glb', 'model']);
	assert.equal(chair.variants[0].unsupported, undefined);
	assert.equal(chair.facts.polyCount, 5000);
	assert.equal(chair.license.commercialUse, true);
	const statue = await polyHavenSource.detail('Huge_Statue');
	assert.match(statue.variants[0].unsupported, /polygons/);
}));

test('a material offers each size with only the maps that size really has', withFixtures(async () => {
	const brick = await polyHavenSource.detail('brick_wall_002');
	assert.deepEqual(brick.variants.map((variant) => variant.id), ['1k', '2k']);
	assert.deepEqual(brick.variants[0].files.map((file) => file.role), ['albedo', 'normal', 'arm']);
	assert.deepEqual(brick.variants[1].files.map((file) => file.role), ['albedo']);
	assert.equal(brick.facts.realWorldSize, 2);
	assert.equal(brick.variants[0].totalBytes, 360_000);
}));

test('paging goes by page number and ends', withFixtures(async () => {
	const first = await polyHavenSource.search({ text: '', kind: 'model', limit: 1 });
	assert.equal(first.next, '1');
	assert.equal(first.total, 2, 'the model over the polygon budget is not offered at all');
	const second = await polyHavenSource.search({ text: '', kind: 'model', limit: 1, cursor: '1' });
	assert.equal(second.next, null);
	assert.notEqual(first.items[0].ref, second.items[0].ref);
	await assert.rejects(polyHavenSource.search({ text: '', kind: 'audio' }), (error) => error.status === 400);
}));

test('only its own virtual model addresses are opened; any other file is left to be fetched directly', async () => {
	assert.equal(await polyHavenSource.open({ role: 'albedo', url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/a/a.jpg', format: 'jpg' }), null);
});
