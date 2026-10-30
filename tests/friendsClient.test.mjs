import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestBridge, QuestBridgeError } from '../packages/engine/src/xr/platform/questBridge.ts';
import { createFriendsApi, FriendsError } from '../packages/engine/src/xr/platform/friends.ts';

/** The page's window and the Quest app's end of the channel, as far as the bridge can tell. */
function fakeApp({ answer = () => ({}) } = {}) {
	const listeners = new Set();
	const host = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
	const sent = [];
	const port = {
		onmessage: null,
		postMessage(raw) {
			const message = JSON.parse(raw);
			sent.push(message);
			const reply = answer(message);
			if (reply !== undefined) queueMicrotask(() => port.onmessage?.({ data: JSON.stringify({ id: message.id, ...reply }) }));
		}
	};
	return { host, port, sent, listeners, arrive: () => listeners.forEach((fn) => fn({ ports: [port] })) };
}

test('outside the Quest app no port arrives: the bridge is unavailable and every request fails', async () => {
	const app = fakeApp();
	const bridge = createQuestBridge(app.host);
	assert.equal(bridge.available, false);
	await assert.rejects(bridge.request('getLoggedInUser'), QuestBridgeError);
	assert.equal(await bridge.whenAvailable(0), false);
	assert.equal(await bridge.whenAvailable(10), false);
	assert.equal(createQuestBridge(null).available, false);
});

test('the app opens the channel with a port; requests and answers are matched by id, even out of order', async () => {
	const held = [];
	const app = fakeApp({ answer: (message) => { held.push(message); return message.method === 'getUserProof' ? { result: { nonce: 'n1' } } : undefined; } });
	const bridge = createQuestBridge(app.host);
	const arrived = bridge.whenAvailable(1000);
	app.arrive();
	assert.equal(await arrived, true);
	assert.equal(bridge.available, true);
	const slow = bridge.request('getLoggedInUser');
	const fast = bridge.request('getUserProof');
	assert.deepEqual(await fast, { nonce: 'n1' });
	app.port.onmessage({ data: JSON.stringify({ id: held[0].id, result: { id: '42' } }) });
	assert.deepEqual(await slow, { id: '42' });
	assert.deepEqual(app.sent.map((m) => m.method), ['getLoggedInUser', 'getUserProof']);
	app.port.onmessage({ data: 'not json' });
	app.port.onmessage({ data: JSON.stringify({ id: 999, result: 1 }) });
});

test('an error from the app, or silence, rejects the request', async () => {
	const app = fakeApp({ answer: (message) => (message.method === 'getLoggedInUserFriends' ? { error: 'Friends permission missing' } : undefined) });
	const bridge = createQuestBridge(app.host, { timeoutMs: 20 });
	app.arrive();
	await assert.rejects(bridge.request('getLoggedInUserFriends'), /Friends permission missing/);
	await assert.rejects(bridge.request('getLoggedInUser'), /did not answer/);
	bridge.dispose();
	assert.equal(bridge.available, false);
	assert.equal(app.listeners.size, 0);
});

function fakeServer(routes) {
	const calls = [];
	const fetchImpl = async (path, init = {}) => {
		const key = `${init.method ?? 'GET'} ${path}`;
		calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
		const route = routes[key];
		if (!route) return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) };
		return { ok: route.status === undefined, status: route.status ?? 200, json: async () => route.body };
	};
	return { fetchImpl, calls };
}

test('the friends API sends what the server expects and explains failures in short words', async () => {
	const { fetchImpl, calls } = fakeServer({
		'GET /api/friends': { body: { friends: [], incoming: [], outgoing: [] } },
		'POST /api/friends/requests': { body: { status: 'pending' } },
		'POST /api/friends/requests/r%2F1': { body: { status: 'friends' } },
		'DELETE /api/friends/u1': { body: { ok: true } },
		'POST /api/friends/blocks': { status: 429, body: { message: 'x' } }
	});
	const api = createFriendsApi(fetchImpl);
	assert.deepEqual(await api.overview(), { friends: [], incoming: [], outgoing: [] });
	assert.deepEqual(await api.sendRequest({ code: 'ABCD-2345' }), { status: 'pending' });
	await api.accept('r/1');
	await api.remove('u1');
	assert.deepEqual(calls.map((c) => c.body), [undefined, { code: 'ABCD-2345' }, { action: 'accept' }, undefined]);
	await assert.rejects(api.block('u1'), (error) => error instanceof FriendsError && error.status === 429 && /Too many/.test(error.message));
	await assert.rejects(api.newCode(), (error) => error instanceof FriendsError && error.status === 404 && /No one/.test(error.message));
	await assert.rejects(createFriendsApi(async () => { throw new TypeError('offline'); }).overview(), (error) => error.status === 0);
});

test('finding Meta friends asks the app for the user, the proof and the friends, and returns the server suggestions', async () => {
	const app = fakeApp({ answer: (message) => ({ result: { getLoggedInUser: { id: '1001' }, getUserProof: { nonce: 'proof' }, getLoggedInUserFriends: { ids: ['2002'] } }[message.method] }) });
	const bridge = createQuestBridge(app.host);
	app.arrive();
	const suggestion = { id: 'b', name: 'Beto', username: 'beto', image: null };
	const { fetchImpl, calls } = fakeServer({ 'POST /api/friends/providers/meta/sync': { body: { suggestions: [suggestion] } } });
	const api = createFriendsApi(fetchImpl, () => bridge);
	assert.equal(api.canFindPlatformFriends(), true);
	assert.deepEqual(await api.findQuestFriends(), [suggestion]);
	assert.deepEqual(calls[0].body, { proof: { metaUserId: '1001', nonce: 'proof' }, friendIds: ['2002'] });
});

test('outside the Quest app finding Meta friends explains where to open the game', async () => {
	const bridge = createQuestBridge(fakeApp().host);
	const api = createFriendsApi(fakeServer({}).fetchImpl, () => bridge);
	assert.equal(api.canFindPlatformFriends(), false);
	await assert.rejects(api.findQuestFriends(), /Quest app/);
});

test('friend codes are shown with a dash, and what was typed is told apart from a username', async () => {
	const { formatFriendCode, looksLikeFriendCode } = await import('../packages/engine/src/xr/platform/friends.ts');
	assert.equal(formatFriendCode('ABCD2345'), 'ABCD-2345');
	assert.equal(formatFriendCode('odd'), 'odd');
	for (const code of ['ABCD-2345', 'abcd-2345', 'ABCD2345', ' ABCD-2345 ']) assert.equal(looksLikeFriendCode(code), true, code);
	for (const name of ['ana', 'beto_99', 'abcd2345', 'ABCD-23456']) assert.equal(looksLikeFriendCode(name), false, name);
});

test('Friends and Friends+ can be hosted now', async () => {
	const { WORLD_VISIBILITY_INFO, isHostedWorldVisibility } = await import('../packages/engine/src/worldVisibility.ts');
	for (const visibility of ['friends', 'friends-plus']) {
		assert.equal(isHostedWorldVisibility(visibility), true);
		assert.doesNotMatch(WORLD_VISIBILITY_INFO[visibility].description, /unavailable/i);
	}
});
