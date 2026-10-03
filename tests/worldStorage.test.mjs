import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_LIMITS, StorageOpError, applyOps, isBetterScore, parseStorageRequest } from '../src/lib/worldStorage/ops.ts';

const entries = (obj = {}) => new Map(Object.entries(obj).map(([k, [value, version]]) => [k, { value, version }]));

test('requests are validated before they touch storage', () => {
  assert.throws(() => parseStorageRequest(null), StorageOpError);
  assert.throws(() => parseStorageRequest({ scope: 'global', ops: [{ op: 'get', key: 'a' }] }), StorageOpError);
  assert.throws(() => parseStorageRequest({ scope: 'player', ops: [] }), StorageOpError);
  assert.throws(() => parseStorageRequest({ scope: 'player', ops: [{ op: 'get', key: 'bad key!' }] }), StorageOpError);
  assert.throws(() => parseStorageRequest({ scope: 'player', ops: [{ op: 'set', key: 'a', value: 'x'.repeat(STORAGE_LIMITS.maxValueBytes) }] }), /too large/);
  assert.throws(() => parseStorageRequest({ scope: 'player', ops: [{ op: 'increment', key: 'a', by: Infinity }] }), StorageOpError);
  assert.throws(() => parseStorageRequest({ scope: 'player', ops: Array(STORAGE_LIMITS.maxOpsPerRequest + 1).fill({ op: 'get', key: 'a' }) }), StorageOpError);
  assert.equal(parseStorageRequest({ scope: 'world', ops: [{ op: 'get', key: 'a.b:c-d_1' }] }).ops.length, 1);
});

test('increment starts from zero and bumps the version', () => {
  const { results } = applyOps(entries({ coins: [10, 3] }), [{ op: 'increment', key: 'coins', by: 5 }, { op: 'increment', key: 'games', by: 1 }]);
  assert.deepEqual(results, [{ value: 15, version: 4 }, { value: 1, version: 1 }]);
});

test('a purchase is all or nothing: spending and unlocking succeed or fail together', () => {
  const purchase = [{ op: 'increment', key: 'coins', by: -100, min: 0 }, { op: 'addToSet', key: 'upgrades', value: 'generator-2' }];
  const ok = applyOps(entries({ coins: [450, 1], upgrades: [['storage-3'], 1] }), purchase);
  assert.deepEqual(ok.results.map((r) => r.value), [350, ['storage-3', 'generator-2']]);
  assert.throws(() => applyOps(entries({ coins: [50, 1] }), purchase), (err) => err.kind === 'conflict');
});

test('addToSet never duplicates, including object items, and does not bump the version', () => {
  const first = applyOps(entries({ s: [[{ id: 1 }], 2] }), [{ op: 'addToSet', key: 's', value: { id: 1 } }]);
  assert.deepEqual(first.results[0], { value: [{ id: 1 }], version: 2 });
  assert.equal(first.states.size, 0);
  const removed = applyOps(entries({ s: [['a', 'b'], 2] }), [{ op: 'removeFromSet', key: 's', value: 'a' }]);
  assert.deepEqual(removed.results[0].value, ['b']);
});

test('later operations on a key see the earlier ones in the same request', () => {
  const { results, states } = applyOps(entries(), [{ op: 'increment', key: 'n', by: 2 }, { op: 'increment', key: 'n', by: 3 }]);
  assert.deepEqual(results.map((r) => r.value), [2, 5]);
  assert.equal(states.get('n').entry.version, 2);
});

test('set honours expectedVersion and type mismatches are rejected', () => {
  assert.throws(() => applyOps(entries({ k: ['a', 2] }), [{ op: 'set', key: 'k', value: 'b', expectedVersion: 1 }]), (err) => err.kind === 'conflict');
  assert.equal(applyOps(entries({ k: ['a', 2] }), [{ op: 'set', key: 'k', value: 'b', expectedVersion: 2 }]).results[0].version, 3);
  assert.equal(applyOps(entries(), [{ op: 'set', key: 'k', value: 1, expectedVersion: 0 }]).results[0].version, 1);
  assert.throws(() => applyOps(entries({ k: ['text', 1] }), [{ op: 'increment', key: 'k', by: 1 }]), (err) => err.kind === 'bad');
  assert.throws(() => applyOps(entries({ k: [5, 1] }), [{ op: 'addToSet', key: 'k', value: 1 }]), (err) => err.kind === 'bad');
});

test('remove deletes an existing key and ignores a missing one', () => {
  assert.equal(applyOps(entries({ k: [1, 1] }), [{ op: 'remove', key: 'k' }]).states.get('k').kind, 'delete');
  assert.equal(applyOps(entries(), [{ op: 'remove', key: 'k' }]).states.size, 0);
});

test('sets are capped', () => {
  const big = Array.from({ length: STORAGE_LIMITS.maxSetItems }, (_, i) => i);
  assert.throws(() => applyOps(entries({ s: [big, 1] }), [{ op: 'addToSet', key: 's', value: 'x' }]), (err) => err.kind === 'conflict');
});

test('leaderboard orders decide which score is better', () => {
  assert.ok(isBetterScore('high', 10, 5));
  assert.ok(!isBetterScore('high', 5, 5));
  assert.ok(isBetterScore('low', 4.2, 5));
});

// --- the service that routes a script's calls ---
import { WorldStorageService } from '../src/lib/xr/worldStorageService.ts';

const service = (over = {}) => {
  const state = { publication: null, role: 'solo', signedIn: true, room: null, relayed: [], fetched: [], ...over };
  const svc = new WorldStorageService({
    getLocalPlayerId: () => 'me',
    getPlayerName: (id) => `name-${id}`,
    getPublication: () => state.publication,
    getRoomCode: () => state.room,
    getRole: () => state.role,
    isSignedIn: () => state.signedIn,
    relay: async (id, call) => { state.relayed.push([id, call]); return state.relayResult ?? { ok: true, data: [{ value: 7, version: 1 }] }; },
    fetch: async (url, init) => { state.fetched.push([url, JSON.parse(init.body)]); return Response.json({ results: [{ value: 3, version: 1 }] }); }
  });
  return { svc, state };
};

test('a draft keeps data in memory per player and forgets it on reset', async () => {
  const { svc } = service();
  assert.equal(await svc.player({ id: 'me' }).increment('coins', 5), 5);
  assert.equal(await svc.player('other').get('coins', 0), 0);
  assert.equal(await svc.world.increment('games'), 1);
  assert.equal(await svc.player({ id: 'me' }).get('coins'), 5);
  svc.reset();
  assert.equal(await svc.player({ id: 'me' }).get('coins', 'none'), 'none');
});

test('a published world without an account is unavailable and degrades to defaults', async () => {
  const { svc, state } = service({ publication: { publicationId: 'pub', revisionId: null }, signedIn: false });
  assert.equal(svc.available, false);
  assert.equal(await svc.player({ id: 'me' }).get('coins', 12), 12);
  assert.equal(await svc.player({ id: 'me' }).increment('coins'), undefined);
  assert.equal(await svc.boards.submit('score', { id: 'me' }, 10), null);
  assert.deepEqual(await svc.boards.top('score'), []);
  assert.equal(state.fetched.length, 0);
});

test('a signed-in player of a published world is stored on the server, and guests send their room', async () => {
  const solo = service({ publication: { publicationId: 'pub 1', revisionId: null } });
  assert.equal(await solo.svc.player({ id: 'me' }).increment('coins', 3), 3);
  assert.equal(solo.state.fetched[0][0], '/api/published-worlds/pub%201/storage');
  const guest = service({ publication: { publicationId: 'pub', revisionId: null }, role: 'guest', room: 'abc' });
  await guest.svc.player({ id: 'me' }).get('x');
  assert.equal(guest.state.fetched[0][0], '/api/published-worlds/pub/storage?room=abc');
});

test("a host reaches a guest's data through the guest, never with its own account", async () => {
  const { svc, state } = service({ publication: { publicationId: 'pub', revisionId: null }, role: 'host' });
  assert.equal(await svc.player({ id: 'guest-1' }).get('coins'), 7);
  assert.equal(state.fetched.length, 0);
  assert.deepEqual(state.relayed[0], ['guest-1', { api: 'storage', ops: [{ op: 'get', key: 'coins' }] }]);
  state.relayResult = { ok: false, error: 'That player left' };
  await assert.rejects(svc.player({ id: 'guest-1' }).get('coins'), /left/);
  state.relayResult = { ok: true, unavailable: true };
  assert.equal(await svc.player({ id: 'guest-1' }).get('coins', 9), 9);
});

test("a guest cannot touch another player's data", async () => {
  const { svc } = service({ publication: { publicationId: 'pub', revisionId: null }, role: 'guest', room: 'abc' });
  await assert.rejects(svc.player({ id: 'someone-else' }).get('coins'), /Only the host/);
});

test('a guest runs only well-formed player-scope calls from the host, with its own account', async () => {
  const { svc, state } = service({ role: 'guest', room: 'abc' });
  const ok = await svc.handleRelayed('pub', { api: 'storage', ops: [{ op: 'increment', key: 'coins', by: 1 }] });
  assert.deepEqual(ok, { ok: true, data: [{ value: 3, version: 1 }] });
  assert.equal(state.fetched[0][0], '/api/published-worlds/pub/storage?room=abc');
  assert.equal(state.fetched[0][1].scope, 'player');
  for (const bad of [null, { api: 'storage', ops: [] }, { api: 'storage', ops: [{ op: 'get', key: '../x' }] }, { api: 'delete-everything' }, { api: 'board-submit', name: 'a', score: 'x', order: 'high' }]) {
    assert.equal((await svc.handleRelayed('pub', bad)).ok, false);
  }
  state.signedIn = false;
  assert.deepEqual(await svc.handleRelayed('pub', { api: 'board-read', name: 'a', limit: 5 }), { ok: true, unavailable: true });
});

test('draft leaderboards keep each player\'s best and rank by the board order', async () => {
  const { svc } = service();
  await svc.boards.submit('time', { id: 'a' }, 30, { order: 'low' });
  await svc.boards.submit('time', { id: 'b' }, 20, { order: 'high' }); // the first submit decided the order
  const again = await svc.boards.submit('time', { id: 'a' }, 40);
  assert.deepEqual([again.improved, again.score, again.order], [false, 30, 'low']);
  const top = await svc.boards.top('time', { limit: 5 });
  assert.deepEqual(top.map((row) => [row.rank, row.score]), [[1, 20], [2, 30]]);
  assert.deepEqual(await svc.boards.best('time', { id: 'a' }), { score: 30, rank: 2 });
});
