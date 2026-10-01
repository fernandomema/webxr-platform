import test from 'node:test';
import assert from 'node:assert/strict';
import { requestScriptJson } from '../src/lib/xr/scriptNet.ts';

test('script networking supports local GET and JSON POST, omitting credentials on external requests', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'http://localhost:5173' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const requests = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, options }); return Response.json({ ok: true }); });
	assert.deepEqual(await requestScriptJson('/api/feedback'), { ok: true });
	await requestScriptJson('/api/feedback', 'POST', { action: 'mood', key: 'good' });
	assert.equal(requests[1].options.method, 'POST');
	assert.equal(requests[1].options.body, '{"action":"mood","key":"good"}');
	assert.equal(requests[1].options.credentials, 'same-origin');
	await requestScriptJson('https://example.com/data');
	assert.equal(requests[2].options.credentials, 'omit');
	await assert.rejects(requestScriptJson('http://example.com/data'), /require HTTPS/);
	await assert.rejects(requestScriptJson('file:///tmp/data'), /require HTTPS/);
});

test('script HTTP failures include the server error for UI messages', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'Invalid feedback' }, { status: 400 }));
	await assert.rejects(requestScriptJson('https://example.com/data', 'POST', {}), /Invalid feedback/);
});
