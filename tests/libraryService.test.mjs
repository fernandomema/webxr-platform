import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { createLibrary } = await import('../src/lib/server/library/service.ts');

const CC0 = { name: 'CC0', commercialUse: true, attributionRequired: false };
const NC = { name: 'NC', commercialUse: false, attributionRequired: true };
const item = (source, id, license = CC0, kind = 'model') => ({ ref: `${source}:${id}`, kind, title: id, license, tags: [], sourceUrl: 'https://example.com/a', downloadable: true });

function fake(id, { items = [], kinds = ['model'], access = 'api', covers, hosts = ['dl.example.com'], variants, fail, open, downloadable = true } = {}) {
	const calls = [];
	return {
		calls,
		info: { id, name: id.toUpperCase(), homepage: 'https://example.com', kinds, access, allowedHosts: hosts, ...(covers ? { covers } : {}) },
		async search(query) {
			calls.push(query);
			if (fail) throw new Error('boom');
			const start = Number(query.cursor ?? 0);
			const page = items.slice(start, start + (query.limit ?? 24));
			return { items: page, next: start + page.length < items.length ? String(start + page.length) : null, total: items.length };
		},
		async detail(nativeId) {
			return { ...item(id, nativeId), downloadable, variants: variants ?? [{ id: 'v', label: 'V', format: 'glb', files: [{ role: 'model', url: `https://dl.example.com/${nativeId}.glb`, format: 'glb' }] }] };
		},
		...(open ? { open } : {})
	};
}

test('a search on one source passes its cursor through and drops items that break the contract', async () => {
	const source = fake('a', { items: [item('a', 'one'), { ref: 'nope' }, item('a', 'two'), item('a', 'three')] });
	const library = createLibrary([source]);
	const first = await library.search({ source: 'a', kind: 'model', text: ' chair ', limit: 2 });
	assert.deepEqual(first.items.map((x) => x.ref), ['a:one'], 'the invalid one is dropped');
	assert.equal(first.next, '2');
	assert.equal(source.calls[0].text, 'chair');
	const second = await library.search({ source: 'a', kind: 'model', text: '', cursor: first.next, limit: 2 });
	assert.deepEqual(second.items.map((x) => x.ref), ['a:two', 'a:three']);
	assert.equal(second.next, null);
});

test('requests are checked: unknown kind, unknown source, a kind the source lacks', async () => {
	const library = createLibrary([fake('a')]);
	await assert.rejects(library.search({ source: 'a', kind: 'sofa', text: '' }), (e) => e.status === 400);
	await assert.rejects(library.search({ source: 'zzz', kind: 'model', text: '' }), (e) => e.status === 404);
	await assert.rejects(library.search({ source: 'a', kind: 'audio', text: '' }), (e) => e.status === 400);
	await assert.rejects(library.search({ source: 'all', kind: 'model', text: '', cursor: '%%%' }), (e) => e.status === 400);
});

test('a merged search takes turns between sources, pages each by its own cursor and drops copies of what a direct source has', async () => {
	const a = fake('polyhaven', { items: [item('polyhaven', 'x1'), item('polyhaven', 'x2')] });
	const b = fake('agg', { covers: ['polyhaven'], items: [item('agg', 'polyhaven:x1'), item('agg', 'other:y1'), item('agg', 'other:y2')] });
	const library = createLibrary([a, b]);
	const first = await library.search({ source: 'all', kind: 'model', text: '', limit: 1 });
	assert.deepEqual(first.items.map((x) => x.ref), ['polyhaven:x1']);
	const merged = await library.search({ source: 'all', kind: 'model', text: '', limit: 5 });
	assert.deepEqual(merged.items.map((x) => x.ref), ['polyhaven:x1', 'agg:other:y1', 'polyhaven:x2', 'agg:other:y2'], 'the aggregator\'s copy of x1 is gone');
	assert.equal(merged.next, null);
	const paged = await library.search({ source: 'all', kind: 'model', text: '', limit: 1, cursor: first.next });
	assert.ok(paged.items.length >= 1);
});

test('in a merged search a failing source is reported while the others answer; alone, it is an error', async () => {
	const good = fake('good', { items: [item('good', 'one')] });
	const bad = fake('bad', { fail: true });
	const library = createLibrary([good, bad]);
	const merged = await library.search({ source: 'all', kind: 'model', text: '' });
	assert.deepEqual(merged.items.map((x) => x.ref), ['good:one']);
	assert.equal(merged.errors[0].source, 'bad');
	await assert.rejects(library.search({ source: 'bad', kind: 'model', text: '' }), (e) => e.status === 502);
	await assert.rejects(createLibrary([bad]).search({ source: 'all', kind: 'model', text: '' }), (e) => e.status === 502, 'nobody answered');
});

test('commercial-only hides what does not clearly allow it', async () => {
	const library = createLibrary([fake('a', { items: [item('a', 'free'), item('a', 'nc', NC), item('a', 'unknown', { name: '?', commercialUse: 'unknown', attributionRequired: 'unknown' })] })]);
	const all = await library.search({ source: 'a', kind: 'model', text: '' });
	assert.equal(all.items.length, 3);
	const filtered = await library.search({ source: 'a', kind: 'model', text: '', filters: { commercialOnly: true } });
	assert.deepEqual(filtered.items.map((x) => x.ref), ['a:free']);
});

test('a detail is checked and cached, and keeps the ref that was asked for', async () => {
	let calls = 0;
	const source = fake('a');
	const original = source.detail;
	source.detail = async (id) => { calls++; return original(id); };
	const library = createLibrary([source]);
	const found = await library.detail('a:chair');
	assert.equal(found.ref, 'a:chair');
	await library.detail('a:chair');
	assert.equal(calls, 1);
	await assert.rejects(library.detail('nonsense'), (e) => e.status === 400);
	const broken = createLibrary([{ ...fake('b'), detail: async () => ({ title: '' }) }]);
	await assert.rejects(broken.detail('b:x'), (e) => e.status === 502);
});

test('a file comes from the source\'s own address, by role, and only when it may be taken', async () => {
	const stub = (body = 'bytes') => { const original = globalThis.fetch; const calls = []; globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(body); }; return { calls, restore: () => { globalThis.fetch = original; } }; };
	const maps = [{ id: '1k', label: '1K', format: 'jpg', files: [{ role: 'albedo', url: 'https://dl.example.com/a.jpg', format: 'jpg' }, { role: 'albedo', url: 'https://dl.example.com/b.jpg', format: 'jpg' }] }];
	const library = createLibrary([fake('a', { variants: maps })]);
	const net = stub();
	try {
		const got = await library.file('a:wall', '1k', 'albedo', 1);
		assert.equal(new TextDecoder().decode(got.bytes), 'bytes');
		assert.deepEqual(net.calls, ['https://dl.example.com/b.jpg'], 'the second albedo file');
		assert.match(got.filename, /^wall-albedo\.jpg$/);
		await assert.rejects(library.file('a:wall', 'nope', 'albedo'), (e) => e.status === 404);
		await assert.rejects(library.file('a:wall', '1k', 'normal'), (e) => e.status === 404);
	} finally { net.restore(); }
	const evil = createLibrary([fake('e', { variants: [{ id: 'v', label: 'V', format: 'glb', files: [{ role: 'model', url: 'https://evil.example/x.glb', format: 'glb' }] }] })]);
	await assert.rejects(evil.file('e:x', 'v', 'model'), (e) => e.status === 502, 'a host the source did not declare');
});

test('a source that has an open step is only asked about the files it handles; the rest are fetched directly', async () => {
	const stub = () => { const original = globalThis.fetch; const calls = []; globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('plain'); }; return { calls, restore: () => { globalThis.fetch = original; } }; };
	const variants = [{ id: 'v', label: 'V', format: 'glb', files: [{ role: 'model', url: 'https://dl.example.com/plain.glb', format: 'glb' }, { role: 'albedo', url: 'virtual://x', format: 'jpg' }] }];
	const source = fake('p', { variants, open: async (file) => (file.url.startsWith('virtual://') ? { bytes: new Uint8Array([7]), contentType: 'image/jpeg' } : null) });
	const library = createLibrary([source]);
	const net = stub();
	try {
		assert.equal(new TextDecoder().decode((await library.file('p:x', 'v', 'model')).bytes), 'plain');
		assert.deepEqual(net.calls, ['https://dl.example.com/plain.glb']);
		assert.deepEqual([...(await library.file('p:x', 'v', 'albedo')).bytes], [7]);
	} finally { net.restore(); }
});

test('files that can not be taken say why', async () => {
	await assert.rejects(createLibrary([fake('l', { access: 'link' })]).file('l:x', 'v', 'model'), (e) => e.status === 409 && /own site/.test(e.message));
	await assert.rejects(createLibrary([fake('d', { downloadable: false })]).file('d:x', 'v', 'model'), (e) => e.status === 409);
	const unsupported = [{ id: 'v', label: 'V', format: 'fbx', unsupported: 'needs conversion', files: [{ role: 'model', url: 'https://dl.example.com/x.fbx', format: 'fbx' }] }];
	await assert.rejects(createLibrary([fake('u', { variants: unsupported })]).file('u:x', 'v', 'model'), (e) => e.status === 409 && /conversion/.test(e.message));
	const several = [{ id: 'v', label: 'V', format: 'gltf', files: [{ role: 'model', url: 'https://dl.example.com/x.gltf', format: 'gltf', includes: [{ path: 'x.bin', url: 'https://dl.example.com/x.bin' }] }] }];
	await assert.rejects(createLibrary([fake('s', { variants: several })]).file('s:x', 'v', 'model'), (e) => e.status === 409 && /several files/.test(e.message));
});

test('a source that assembles its own file is asked to, and its answer still has a size cap', async () => {
	const variants = [{ id: 'v', label: 'V', format: 'glb', files: [{ role: 'model', url: 'virtual://model/x', format: 'glb' }] }];
	const ok = createLibrary([fake('o', { variants, open: async () => ({ bytes: new Uint8Array(10), contentType: 'model/gltf-binary' }) })]);
	assert.equal((await ok.file('o:x', 'v', 'model')).contentType, 'model/gltf-binary');
	const huge = createLibrary([fake('h', { variants, open: async () => ({ bytes: new Uint8Array(26 * 1024 * 1024), contentType: 'model/gltf-binary' }) })]);
	await assert.rejects(huge.file('h:x', 'v', 'model'), (e) => e.status === 413);
});

test('what can not be imported is left out of a search unless it is asked for', async () => {
	const stuck = { ...item('a', 'link-only'), downloadable: false };
	const library = createLibrary([fake('a', { items: [item('a', 'ok'), stuck] })]);
	assert.deepEqual((await library.search({ source: 'a', kind: 'model', text: '' })).items.map((x) => x.ref), ['a:ok']);
	assert.deepEqual((await library.search({ source: 'a', kind: 'model', text: '', filters: { importableOnly: false } })).items.map((x) => x.ref), ['a:ok', 'a:link-only']);
});
