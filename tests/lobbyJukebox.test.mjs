import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { collectAssetIds } from '../src/lib/assets/ref.ts';

const lobby = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/lobby.json', import.meta.url), 'utf8'));
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('the lobby record player has a socket that takes discs', () => {
  const sockets = lobby.filter((slot) => find(slot, 'socket'));
  assert.equal(sockets.length, 1);
  const socket = find(sockets[0], 'socket');
  assert.deepEqual(socket.accepts, ['disc']);
  assert.ok(socket.radius > 0);
  assert.equal(socket.occupantId, undefined, 'a template never ships with something already inserted');
  assert.deepEqual(sockets[0].scale, [1, 1, 1], 'a scaled socket would squash whatever sits in it');
});

test('every lobby disc can be grabbed, fits the socket and plays a bundled file', () => {
  const discs = lobby.filter((slot) => find(slot, 'insertable'));
  assert.ok(discs.length >= 2);
  const socket = find(lobby.find((slot) => find(slot, 'socket')), 'socket');
  for (const disc of discs) {
    assert.ok(find(disc, 'grabbable'), `${disc.name} must be grabbable`);
    assert.ok(find(disc, 'meshRenderer'), `${disc.name} needs a mesh to carry its sound`);
    assert.ok(socket.accepts.includes(find(disc, 'insertable').tag));
    const audio = find(disc, 'audioPlayer');
    assert.equal(audio.source.kind, 'url');
    assert.ok(!audio.playing && !audio.autoplay, 'a disc only plays once it is in the player');
    assert.ok(existsSync(new URL(`../static${audio.source.url}`, import.meta.url)), `${audio.source.url} is missing`);
  }
});

test('slot ids stay unique and the lobby needs no cloud assets', () => {
  assert.equal(new Set(lobby.map((slot) => slot.id)).size, lobby.length);
  assert.equal(collectAssetIds(lobby).size, 0);
});
