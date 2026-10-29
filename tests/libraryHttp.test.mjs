import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = specifier.startsWith('.') && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
		return nextResolve(resolved, context);
	}
});
const { assertAllowedUrl, assertPublicHost, isPublicAddress, fetchLimited, createJsonClient, TtlCache, LibraryError } = await import('../src/lib/server/library/http.ts');

const refused = (value, hosts = ['dl.example.com']) => { try { assertAllowedUrl(value, hosts); return null; } catch (error) { return error instanceof LibraryError ? error.status : error; } };

test('only https files from an allowed named host, on the default port and without credentials, are fetched', () => {
	assert.equal(refused('https://dl.example.com/a.jpg'), null);
	assert.equal(refused('https://cdn.example.com/a.jpg', ['*.example.com']), null);
	assert.equal(refused('https://example.com/a.jpg', ['*.example.com']), 502, 'a wildcard is for subdomains');
	for (const bad of ['http://dl.example.com/a', 'https://evil.com/a', 'https://dl.example.com.evil.com/a', 'https://user:pw@dl.example.com/a', 'https://dl.example.com:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/a', 'not a url', '//dl.example.com/a']) assert.equal(refused(bad, ['dl.example.com', '127.0.0.1', '169.254.169.254']), 502, bad);
});

function stubFetch(handler) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => { calls.push(String(url)); return handler(String(url), init); };
	return { calls, restore: () => { globalThis.fetch = original; } };
}
const bytesOf = (text, init) => new Response(text, init);

test('a redirect is followed only to another allowed host', async () => {
	const stub = stubFetch((url) => (url.endsWith('/start') ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/file' } }) : bytesOf('ok', { headers: { 'content-type': 'image/png' } })));
	try {
		const got = await fetchLimited('https://dl.example.com/start', { allowedHosts: ['dl.example.com', 'cdn.example.com'], maxBytes: 100 });
		assert.equal(new TextDecoder().decode(got.bytes), 'ok');
		assert.equal(got.contentType, 'image/png');
		assert.deepEqual(stub.calls, ['https://dl.example.com/start', 'https://cdn.example.com/file']);
		await assert.rejects(fetchLimited('https://dl.example.com/start', { allowedHosts: ['dl.example.com'], maxBytes: 100 }), (error) => error.status === 502);
	} finally { stub.restore(); }
});

test('a file over the size cap is refused, by its declared size and by what actually arrives', async () => {
	const stub = stubFetch((url) => (url.endsWith('/declared') ? bytesOf('x', { headers: { 'content-length': '5000' } }) : bytesOf('x'.repeat(5000))));
	try {
		for (const path of ['declared', 'streamed']) await assert.rejects(fetchLimited(`https://dl.example.com/${path}`, { allowedHosts: ['dl.example.com'], maxBytes: 1000 }), (error) => error.status === 413, path);
	} finally { stub.restore(); }
});

test('errors from the source become errors a person can read', async () => {
	for (const [status, expected] of [[404, 404], [429, 503], [500, 502]]) {
		const stub = stubFetch(() => new Response('no', { status }));
		try { await assert.rejects(fetchLimited('https://dl.example.com/a', { allowedHosts: ['dl.example.com'], maxBytes: 100 }), (error) => error.status === expected, String(status)); }
		finally { stub.restore(); }
	}
});

test('the JSON client caches, merges identical requests, and stays under its host', async () => {
	const stub = stubFetch(async () => { await new Promise((r) => setTimeout(r, 5)); return bytesOf('{"n":1}', { headers: { 'content-type': 'application/json' } }); });
	try {
		const get = createJsonClient({ base: 'https://api.example.com/v1/', name: 'test-json' });
		const [a, b] = await Promise.all([get('search?q=a'), get('search?q=a')]);
		assert.deepEqual([a, b], [{ n: 1 }, { n: 1 }]);
		await get('search?q=a');
		assert.equal(stub.calls.length, 1, 'one request for three callers');
		await get('search?q=b');
		assert.equal(stub.calls.length, 2);
		await assert.rejects(get('https://other.example.com/x'), (error) => error.status === 502);
	} finally { stub.restore(); }
});

test('the JSON client stops at its own ceiling', async () => {
	const stub = stubFetch(() => bytesOf('{}'));
	try {
		const get = createJsonClient({ base: 'https://api.example.com/', name: 'test-ceiling', requestsPerMinute: 2 });
		await get('a'); await get('b');
		await assert.rejects(get('c'), (error) => error.status === 503);
	} finally { stub.restore(); }
});

test('the cache forgets after its time and keeps to its size', () => {
	const cache = new TtlCache(1000, 2);
	cache.set('a', 1, 0); cache.set('b', 2, 0); cache.set('c', 3, 0);
	assert.equal(cache.get('a', 1), undefined, 'the oldest left');
	assert.equal(cache.get('c', 1), 3);
	assert.equal(cache.get('c', 1001), undefined, 'and it expires');
});

test('only public addresses count as public', () => {
	for (const ok of ['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ok), true, ok);
	for (const bad of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:10.0.0.1', 'not an ip']) assert.equal(isPublicAddress(bad), false, bad);
});

test('a name that points inside the network, or does not exist, is refused', async () => {
	const answer = (...addresses) => async () => addresses;
	await assertPublicHost('grab3d.com', answer('93.184.216.34', '2606:4700::1111'));
	for (const addresses of [['10.0.0.5'], ['93.184.216.34', '127.0.0.1'], []]) await assert.rejects(assertPublicHost('x.example', answer(...addresses)), (error) => error.status === 502, addresses.join());
	await assert.rejects(assertPublicHost('nope.example', async () => { throw new Error('ENOTFOUND'); }), (error) => error.status === 502);
});

test('with any public host allowed, every hop is checked, redirects included', async () => {
	const stub = stubFetch((url) => (url.includes('start') ? new Response(null, { status: 302, headers: { location: 'https://inside.example/secret' } }) : bytesOf('ok')));
	const resolver = async (host) => (host === 'inside.example' ? ['10.0.0.9'] : ['93.184.216.34']);
	try {
		const ok = await fetchLimited('https://grab3d.example/file.glb', { allowedHosts: ['*'], maxBytes: 100, resolver });
		assert.equal(new TextDecoder().decode(ok.bytes), 'ok');
		await assert.rejects(fetchLimited('https://grab3d.example/start', { allowedHosts: ['*'], maxBytes: 100, resolver }), (error) => error.status === 502);
		assert.deepEqual(stub.calls, ['https://grab3d.example/file.glb', 'https://grab3d.example/start'], 'the inside address was never requested');
		await assert.rejects(fetchLimited('https://127.0.0.1/x', { allowedHosts: ['*'], maxBytes: 100, resolver }), (error) => error.status === 502, 'an IP literal is refused even when any host is allowed');
	} finally { stub.restore(); }
});
