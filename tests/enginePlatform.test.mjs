import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, configurePlatform, platformFetch, platformUrl, resetPlatform, signalingAddress, useStoredToken, getPlatformConfig } from '../packages/engine/src/xr/platform/config.ts';
import { startDeviceSignIn } from '../packages/engine/src/xr/platform/deviceSignIn.ts';

const realFetch = globalThis.fetch;
const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let calls;

beforeEach(() => {
	resetPlatform();
	calls = [];
	Object.defineProperty(globalThis, 'location', { value: new URL('https://kithin.test/play'), configurable: true });
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return Response.json({});
	};
});
afterEach(() => {
	globalThis.fetch = realFetch;
	if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
	else delete globalThis.location;
	if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
	else delete globalThis.localStorage;
});

test('by default the engine talks to the site it is served from', async () => {
	assert.equal(platformUrl('/api/credits'), '/api/credits');
	assert.equal(assetUrl('/draco/draco_decoder.wasm'), '/draco/draco_decoder.wasm');
	assert.equal(signalingAddress(), 'wss://kithin.test/signaling');
	await platformFetch('/api/credits');
	assert.equal(calls[0].url, '/api/credits');
	assert.equal(calls[0].init.credentials, 'same-origin');
	assert.equal(new Headers(calls[0].init.headers).has('authorization'), false);
});

test('a game on another site points it at the platform and sends its token instead of a cookie', async () => {
	configurePlatform({ apiBase: 'https://kithin.example/', assetBase: 'https://cdn.example/engine', getToken: () => 'tok' });
	assert.equal(platformUrl('/api/credits'), 'https://kithin.example/api/credits');
	assert.equal(assetUrl('/draco/x.js'), 'https://cdn.example/engine/draco/x.js');
	assert.equal(signalingAddress(), 'wss://kithin.example/signaling');
	await platformFetch('/api/credits', { method: 'POST' });
	assert.equal(calls[0].url, 'https://kithin.example/api/credits');
	assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer tok');
	assert.equal(calls[0].init.credentials, 'omit');
});

test('addresses that are already absolute, and requests that are not for the API, go through untouched', async () => {
	configurePlatform({ apiBase: 'https://kithin.example', getToken: () => 'tok' });
	assert.equal(platformUrl('https://bucket.example/file'), 'https://bucket.example/file');
	await platformFetch('https://bucket.example/file');
	assert.equal(calls[0].url, 'https://bucket.example/file');
	assert.equal(new Headers(calls[0].init?.headers).has('authorization'), false, 'the token is not handed to other sites');
	await platformFetch('https://kithin.example/api/x');
	assert.equal(new Headers(calls[1].init.headers).get('authorization'), 'Bearer tok');
});

test('an explicit signaling address wins', () => {
	configurePlatform({ signalingUrl: 'wss://rooms.example/ws' });
	assert.equal(signalingAddress(), 'wss://rooms.example/ws');
});

test('useStoredToken keeps the token in storage and in memory when storage is blocked', () => {
	const store = new Map();
	Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, configurable: true });
	useStoredToken('t');
	const { getToken, setToken } = getPlatformConfig();
	assert.equal(getToken(), null);
	setToken('abc');
	assert.equal(store.get('t'), 'abc');
	assert.equal(getToken(), 'abc');
	setToken(null);
	assert.equal(getToken(), null);
	Object.defineProperty(globalThis, 'localStorage', { value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }, configurable: true });
	setToken('mem');
	assert.equal(getToken(), 'mem');
});

test('signing in with a code asks for one, waits for the approval and stores the token', async () => {
	const stored = [];
	configurePlatform({ apiBase: 'https://kithin.example', setToken: (token) => stored.push(token), clientId: 'my-world-id' });
	const answers = [
		Response.json({ device_code: 'dev', user_code: 'ABCD1234', verification_uri: 'https://kithin.example/device', verification_uri_complete: 'https://kithin.example/device?user_code=ABCD1234', expires_in: 600, interval: 0.01 }),
		Response.json({ error: 'authorization_pending' }, { status: 400 }),
		Response.json({ access_token: 'session-token', token_type: 'Bearer' })
	];
	globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answers.shift(); };
	const attempt = await startDeviceSignIn();
	assert.equal(attempt.userCode, 'ABCD1234');
	assert.equal(JSON.parse(calls[0].init.body).client_id, 'my-world-id');
	assert.equal(await attempt.done, 'approved');
	assert.deepEqual(stored, ['session-token']);
	assert.equal(JSON.parse(calls[2].init.body).grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
});

test('a refused or cancelled code ends the wait without storing anything', async () => {
	const stored = [];
	configurePlatform({ setToken: (token) => stored.push(token) });
	const code = () => Response.json({ device_code: 'd', user_code: 'U', verification_uri: '/device', verification_uri_complete: '/device?user_code=U', expires_in: 600, interval: 0.01 });
	globalThis.fetch = async (url) => (String(url).endsWith('/code') ? code() : Response.json({ error: 'access_denied' }, { status: 400 }));
	assert.equal(await (await startDeviceSignIn()).done, 'denied');
	globalThis.fetch = async () => code();
	const waiting = await startDeviceSignIn();
	waiting.cancel();
	assert.equal(await waiting.done, 'cancelled');
	assert.deepEqual(stored, []);
});

test('without a place to keep the token, signing in with a code is refused up front', async () => {
	await assert.rejects(startDeviceSignIn(), /token/);
});
