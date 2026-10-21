import test from 'node:test';
import assert from 'node:assert/strict';
import { requestScriptJson } from '../src/lib/xr/scriptNet.ts';

test('script networking supports local GET and JSON POST, omitting credentials on external requests', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'http://localhost:5173' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const requests = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, options }); return Response.json({ ok: true }); });
	const granted = { sameOriginPaths: ['/api/feedback'] };
	assert.deepEqual(await requestScriptJson('/api/feedback', 'GET', undefined, granted), { ok: true });
	await requestScriptJson('/api/feedback', 'POST', { action: 'mood', key: 'good' }, granted);
	assert.equal(requests[1].options.method, 'POST');
	assert.equal(requests[1].options.body, '{"action":"mood","key":"good"}');
	assert.equal(requests[1].options.credentials, 'same-origin');
	await requestScriptJson('https://example.com/data');
	assert.equal(requests[2].options.credentials, 'omit');
	await assert.rejects(requestScriptJson('http://example.com/data'), /require HTTPS/);
	await assert.rejects(requestScriptJson('file:///tmp/data'), /require HTTPS/);
});

test('script networking blocks authenticated same-origin routes outside the allowlist', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'http://localhost:5173' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
	for (const url of ['/api/account', '/api/credits/confirm', '/api/feedbackx', '/api/feedback/../account', 'http://localhost:5173/api/admin', '//localhost:5173/api/inventory']) {
		await assert.rejects(requestScriptJson(url, 'GET', undefined, { sameOriginPaths: ['/api/feedback'] }), /not allowed/, url);
		await assert.rejects(requestScriptJson(url, 'POST', {}, { sameOriginPaths: ['/api/feedback'] }), /not allowed/, url);
	}
	assert.equal(fetchMock.mock.callCount(), 0);
	await assert.rejects(requestScriptJson('/api/feedback'), /not allowed/, 'nothing is granted by default');
	await assert.rejects(requestScriptJson('/api/feedback', 'POST', {}, { sameOriginPaths: [] }), /not allowed/);
	assert.equal(fetchMock.mock.callCount(), 0);
	await requestScriptJson('/api/feedback/stats', 'GET', undefined, { sameOriginPaths: ['/api/feedback'] });
	await assert.rejects(requestScriptJson('/api/account', 'GET', undefined, { sameOriginPaths: ['/api/feedback'] }), /not allowed/, 'a grant is for its own route only');
	assert.equal(fetchMock.mock.callCount(), 1);
});

test('script HTTP failures include the server error for UI messages', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Invalid feedback' }, { status: 400 }));
	await assert.rejects(requestScriptJson('https://example.com/data', 'POST', {}), /Invalid feedback/);
});
