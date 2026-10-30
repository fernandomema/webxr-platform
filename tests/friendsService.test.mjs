import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../src/lib/server/errors.ts';
import { createMetaFriendProvider } from '../src/lib/server/friends/providers/meta.ts';
import { JOIN_TICKET_TTL_MS, signJoinTicket, verifyJoinTicket } from '../src/lib/server/joinTicket.ts';
import { createFriendsDb } from './helpers/friendsFake.mjs';

/** The real service, with its imports replaced by the given stand-ins (the same way creditsService.test.mjs loads one). */
function load(prisma, { providers = [], rate = () => true } = {}) {
	const source = readFileSync(new URL('../src/lib/server/services/friends.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (async )?function /gm, '$1function ');
	const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
	const graphSource = readFileSync(new URL('../src/lib/server/friends/friendGraph.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (async )?function /gm, '$1function ');
	const { reachableHosts } = new Function('prisma', `${ts.transpile(graphSource, { target: ts.ScriptTarget.ES2022 })}\nreturn { reachableHosts };`)(prisma);
	const names = ['env', 'reachableHosts', 'JOIN_TICKET_TTL_MS', 'signJoinTicket', 'ForbiddenError', 'randomBytes', 'prisma', 'BadRequestError', 'ConflictError', 'NotFoundError', 'TooManyRequestsError', 'UnauthorizedError', 'getFriendProvider', 'takeRateToken'];
	const values = [{ CREDITS_SECRET: SECRET }, reachableHosts, JOIN_TICKET_TTL_MS, signJoinTicket, ForbiddenError, (n) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + Math.floor(Math.random() * 200)) % 256)), prisma, BadRequestError, ConflictError, NotFoundError, TooManyRequestsError, UnauthorizedError, (id) => providers.find((p) => p.id === id), rate];
	return new Function(...names, `${js}\nreturn { getFriendsOverview, sendFriendRequest, respondToFriendRequest, cancelFriendRequest, removeFriend, blockUser, unblockUser, listBlockedUsers, getMyFriendCode, regenerateFriendCode, syncProviderFriends, issueJoinTicket };`)(...values);
}

const SECRET = 'ticket-test-secret';
const people = [
	{ id: 'a', name: 'Ana', username: 'ana', displayUsername: 'Ana' },
	{ id: 'b', name: 'Beto', username: 'beto' },
	{ id: 'c', name: 'Cleo', username: 'cleo' },
	{ id: 'd', name: 'Dani', username: 'dani', banned: true }
];
const sessionUser = (id) => ({ id, name: id, email: `${id}@x.y` });
const [A, B, C] = ['a', 'b', 'c'].map(sessionUser);
const setup = (options) => {
	const db = createFriendsDb({ users: people, worlds: { w1: { name: 'Arena', visibility: 'friends' }, w2: { name: 'Hidden', visibility: 'private' } } });
	return { ...db, service: load(db.prisma, options) };
};

test('everything needs a signed-in account', async () => {
	const { service } = setup();
	for (const call of [() => service.getFriendsOverview(null), () => service.sendFriendRequest(null, { username: 'b' }), () => service.respondToFriendRequest(null, {}), () => service.removeFriend(null, {}), () => service.blockUser(null, {}), () => service.getMyFriendCode(null)]) {
		await assert.rejects(call(), UnauthorizedError);
	}
});

test('a request is accepted into a friendship, and the pair is stored in sorted order', async () => {
	const { service, state } = setup();
	assert.deepEqual(await service.sendFriendRequest(B, { username: 'Ana' }), { status: 'pending' });
	assert.deepEqual(await service.sendFriendRequest(B, { username: 'ana' }), { status: 'pending' }, 'asking again changes nothing');
	assert.equal(state.requests.length, 1);
	const { incoming } = await service.getFriendsOverview(A);
	assert.equal(incoming.length, 1);
	assert.equal(incoming[0].from.id, 'b');
	await assert.rejects(service.respondToFriendRequest(B, { requestId: incoming[0].id, action: 'accept' }), NotFoundError, 'only the receiver answers');
	assert.deepEqual(await service.respondToFriendRequest(A, { requestId: incoming[0].id, action: 'accept' }), { status: 'friends' });
	assert.deepEqual(state.friendships.map(({ userAId, userBId }) => [userAId, userBId]), [['a', 'b']]);
	assert.equal(state.requests.length, 0);
	await assert.rejects(service.sendFriendRequest(A, { username: 'beto' }), ConflictError);
	assert.deepEqual((await service.getFriendsOverview(B)).friends.map((f) => f.id), ['a']);
});

test('declining or cancelling deletes the request, and only its sender can cancel', async () => {
	const { service, state } = setup();
	await service.sendFriendRequest(A, { username: 'beto' });
	const [request] = (await service.getFriendsOverview(B)).incoming;
	await assert.rejects(service.cancelFriendRequest(B, { requestId: request.id }), NotFoundError);
	await service.cancelFriendRequest(A, { requestId: request.id });
	assert.equal(state.requests.length, 0);
	await service.sendFriendRequest(A, { username: 'beto' });
	const [again] = (await service.getFriendsOverview(B)).incoming;
	assert.deepEqual(await service.respondToFriendRequest(B, { requestId: again.id, action: 'decline' }), { status: 'declined' });
	assert.equal(state.friendships.length, 0);
	await assert.rejects(service.respondToFriendRequest(B, { requestId: again.id, action: 'maybe' }), BadRequestError);
});

test('two requests that cross become a friendship', async () => {
	const { service, state } = setup();
	await service.sendFriendRequest(A, { username: 'beto' });
	assert.deepEqual(await service.sendFriendRequest(B, { username: 'ana' }), { status: 'friends' });
	assert.equal(state.friendships.length, 1);
	assert.equal(state.requests.length, 0);
});

test('nobody can add themselves, a banned or unknown person, or give neither a username nor a code', async () => {
	const { service } = setup();
	await assert.rejects(service.sendFriendRequest(A, { username: 'ana' }), BadRequestError);
	await assert.rejects(service.sendFriendRequest(A, { username: 'dani' }), NotFoundError);
	await assert.rejects(service.sendFriendRequest(A, { username: 'nobody' }), NotFoundError);
	await assert.rejects(service.sendFriendRequest(A, {}), BadRequestError);
	await assert.rejects(service.sendFriendRequest(A, null), BadRequestError);
	await assert.rejects(service.sendFriendRequest(A, { code: 'short' }), BadRequestError);
});

test('a friend code finds its owner, in any case and with the dash, and a new code retires the old one', async () => {
	const { service } = setup();
	const { code } = await service.getMyFriendCode(B);
	assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
	assert.equal((await service.getMyFriendCode(B)).code, code, 'the same code every time');
	const dashed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
	assert.deepEqual(await service.sendFriendRequest(A, { code: dashed }), { status: 'pending' });
	const fresh = (await service.regenerateFriendCode(B)).code;
	assert.notEqual(fresh, code);
	await assert.rejects(service.sendFriendRequest(C, { code }), NotFoundError);
	assert.deepEqual(await service.sendFriendRequest(C, { code: fresh }), { status: 'pending' });
});

test('blocking ends the friendship and requests, hides the blocker, and unblocking allows asking again', async () => {
	const { service, state } = setup();
	await service.sendFriendRequest(A, { username: 'beto' });
	await service.sendFriendRequest(B, { username: 'ana' });
	await service.sendFriendRequest(C, { username: 'ana' });
	await service.blockUser(A, { userId: 'b' });
	assert.equal(state.friendships.length, 0);
	assert.deepEqual(state.requests.map((r) => r.fromUserId), ['c'], 'only the request between the two is gone');
	await assert.rejects(service.sendFriendRequest(B, { username: 'ana' }), NotFoundError, 'the blocked person just sees nobody');
	await assert.rejects(service.sendFriendRequest(A, { username: 'beto' }), ConflictError);
	assert.deepEqual((await service.listBlockedUsers(A)).map((p) => p.id), ['b']);
	await service.unblockUser(A, { userId: 'b' });
	assert.deepEqual(await service.sendFriendRequest(B, { username: 'ana' }), { status: 'pending' });
	await assert.rejects(service.blockUser(A, { userId: 'a' }), BadRequestError);
	await assert.rejects(service.blockUser(A, { userId: 'ghost' }), NotFoundError);
});

test('removing a friend works from either side and says so when there was none', async () => {
	const { service, state } = setup();
	await service.sendFriendRequest(A, { username: 'beto' });
	await service.sendFriendRequest(B, { username: 'ana' });
	await service.removeFriend(B, { userId: 'a' });
	assert.equal(state.friendships.length, 0);
	await assert.rejects(service.removeFriend(B, { userId: 'a' }), NotFoundError);
});

test('sending requests is rate-limited per account', async () => {
	const { service } = setup({ rate: (key) => { assert.equal(key, 'friend-request:a'); return false; } });
	await assert.rejects(service.sendFriendRequest(A, { username: 'beto' }), TooManyRequestsError);
});

test('a friend shows the session they host only when its visibility lets friends in', async () => {
	const { service, state } = setup();
	await service.sendFriendRequest(A, { username: 'beto' });
	await service.sendFriendRequest(B, { username: 'ana' });
	state.sessions.push({ hostUserId: 'b', worldId: 'w2', roomCode: 'hidden', endedAt: null, startedAt: new Date() });
	assert.equal((await service.getFriendsOverview(A)).friends[0].session, null, 'a private session is not shown');
	state.sessions.push({ hostUserId: 'b', worldId: 'w1', roomCode: 'open', endedAt: null, startedAt: new Date() });
	assert.deepEqual((await service.getFriendsOverview(A)).friends[0].session, { roomCode: 'open', worldName: 'Arena', visibility: 'friends' });
	state.sessions[1].endedAt = new Date();
	assert.equal((await service.getFriendsOverview(A)).friends[0].session, null, 'an ended session is not shown');
});

// --- platform friends (Meta Quest) ---------------------------------------------------------------------------------

const metaWith = (valid, calls = []) => createMetaFriendProvider({ appId: '111', appSecret: 'secret' }, async (url, init) => {
	calls.push({ url, body: init.body.toString() });
	return { ok: true, json: async () => ({ is_valid: valid }) };
});
const sync = (service, user, metaUserId, friendIds, nonce = 'proof') => service.syncProviderFriends(user, 'meta', { proof: { metaUserId, nonce }, friendIds });

test('Meta friends become suggestions only for people who linked their account, and nobody is befriended', async () => {
	const calls = [];
	const { service, state } = setup({ providers: [metaWith(true, calls)] });
	assert.deepEqual((await sync(service, B, '2002', ['1001'])).suggestions, [], 'nobody linked yet');
	const answer = await sync(service, A, '1001', ['2002', '3003', 'not-an-id', '1001']);
	assert.deepEqual(answer.suggestions.map((s) => s.id), ['b']);
	assert.deepEqual(answer.suggestions[0], { id: 'b', name: 'Beto', username: 'beto', image: null });
	assert.equal(state.friendships.length + state.requests.length, 0);
	assert.match(calls[1].url, /graph\.oculus\.com\/user_nonce_validate/);
	assert.match(calls[1].body, /nonce=proof/);
	assert.match(calls[1].body, /user_id=1001/);
	assert.match(calls[1].body, /access_token=OC%7C111%7Csecret/);
});

test('suggestions leave out people already friends, asked, blocked, or without a username', async () => {
	const { service, state } = setup({ providers: [metaWith(true)] });
	await sync(service, B, '2002', []);
	await sync(service, C, '3003', []);
	state.users.get('c').username = null;
	assert.deepEqual((await sync(service, A, '1001', ['2002', '3003'])).suggestions.map((s) => s.id), ['b']);
	await service.sendFriendRequest(A, { username: 'beto' });
	assert.deepEqual((await sync(service, A, '1001', ['2002', '3003'])).suggestions, []);
});

test('a Meta proof that Meta does not confirm links nothing', async () => {
	const { service, state } = setup({ providers: [metaWith(false)] });
	await assert.rejects(sync(service, A, '1001', ['2002']), BadRequestError);
	assert.equal(state.links.length, 0);
	await assert.rejects(service.syncProviderFriends(A, 'meta', { proof: { metaUserId: 'x', nonce: 'n' }, friendIds: [] }), BadRequestError);
	await assert.rejects(service.syncProviderFriends(A, 'steam', {}), NotFoundError, 'a platform nobody added');
});

test('a Meta account belongs to one person: linking it again moves it, and one person has one Meta account', async () => {
	const { service, state } = setup({ providers: [metaWith(true)] });
	await sync(service, A, '1001', []);
	await sync(service, B, '1001', []);
	assert.deepEqual(state.links.map((l) => [l.externalId, l.userId]), [['1001', 'b']]);
	await sync(service, B, '2002', []);
	assert.deepEqual(state.links.map((l) => [l.externalId, l.userId]), [['2002', 'b']]);
});

test('a provider without keys is not available, and the registry can carry another platform', async () => {
	assert.equal(createMetaFriendProvider({}).isAvailable(), false);
	const steam = { id: 'steam', label: 'Steam', isAvailable: () => true, verifyIdentity: async (proof) => proof.steamId, parseFriendIds: (raw) => raw };
	const { service } = setup({ providers: [steam] });
	await service.syncProviderFriends(B, 'steam', { proof: { steamId: '76561' }, friendIds: [] });
	assert.deepEqual((await service.syncProviderFriends(A, 'steam', { proof: { steamId: '76562' }, friendIds: ['76561'] })).suggestions.map((s) => s.id), ['b']);
});

// --- passes for friends-only sessions ----------------------------------------------------------------------------------

test('only the host\'s friends get a pass for a Friends session, and Friends+ also lets friends of friends in', async () => {
	const { service, state } = setup();
	const add = (x, y) => state.friendships.push({ userAId: x < y ? x : y, userBId: x < y ? y : x });
	add('a', 'b'); add('b', 'c');
	// b hosts a Friends session (world w1); a is b's friend, c is b's friend, d is nobody's friend.
	state.sessions.push({ hostUserId: 'b', worldId: 'w1', roomCode: 'room', endedAt: null, startedAt: new Date() });
	const ticket = (await service.issueJoinTicket(A, 'room')).ticket;
	assert.equal(verifyJoinTicket(SECRET, ticket, 'room')?.u, 'a');
	assert.equal(verifyJoinTicket(SECRET, ticket, 'other-room'), null, 'a pass is for one room');
	assert.ok((await service.issueJoinTicket(B, 'room')).ticket, 'the host may enter their own session');
	await assert.rejects(service.issueJoinTicket(sessionUser('d'), 'room'), ForbiddenError);
	state.blocks.push({ blockerId: 'b', blockedId: 'a' });
	await assert.rejects(service.issueJoinTicket(A, 'room'), ForbiddenError, 'a blocked friend is out');
});

test('Friends+ passes reach friends of friends; private, public and missing rooms need no pass; signed-out is refused', async () => {
	const worlds = { plus: { name: 'Plus', visibility: 'friends-plus' }, open: { name: 'Open', visibility: 'public' } };
	const db = createFriendsDb({ users: people, worlds });
	const service = load(db.prisma);
	db.state.friendships.push({ userAId: 'a', userBId: 'b' }, { userAId: 'b', userBId: 'c' });
	db.state.sessions.push({ hostUserId: 'a', worldId: 'plus', roomCode: 'plus-room', endedAt: null }, { hostUserId: 'a', worldId: 'open', roomCode: 'open-room', endedAt: null });
	assert.ok((await service.issueJoinTicket(C, 'plus-room')).ticket, 'c is a friend of a friend of the host');
	assert.deepEqual(await service.issueJoinTicket(sessionUser('d'), 'open-room'), { ticket: null });
	assert.deepEqual(await service.issueJoinTicket(C, 'nowhere'), { ticket: null });
	await assert.rejects(service.issueJoinTicket(null, 'plus-room'), UnauthorizedError);
	await assert.rejects(service.issueJoinTicket(C, ''), BadRequestError);
});

test('a pass cannot be forged, altered or used after it expires', () => {
	const ticket = signJoinTicket(SECRET, { r: 'room', u: 'a', e: Date.now() + JOIN_TICKET_TTL_MS });
	assert.ok(verifyJoinTicket(SECRET, ticket, 'room'));
	assert.equal(verifyJoinTicket('another-secret', ticket, 'room'), null);
	assert.equal(verifyJoinTicket(SECRET, ticket, 'room', Date.now() + JOIN_TICKET_TTL_MS + 1), null, 'expired');
	const [body, signature] = ticket.split('.');
	const forged = Buffer.from(JSON.stringify({ r: 'room', u: 'evil', e: Date.now() + 1e9 })).toString('base64url');
	assert.equal(verifyJoinTicket(SECRET, `${forged}.${signature}`, 'room'), null);
	for (const bad of [undefined, 42, '', 'x', `${body}.`, `${ticket}.extra`]) assert.equal(verifyJoinTicket(SECRET, bad, 'room'), null);
});
