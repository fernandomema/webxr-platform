import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { collectAssetIds } from '../packages/engine/src/assets/ref.ts';

import { buildLobbyExtras } from '../src/lib/content/templates/lobbyExtras.ts';
import { BUILTIN_ENTRIES } from '../src/lib/content/starterKit/catalog.ts';

const recordPlayer = JSON.parse(readFileSync(new URL('../src/lib/content/templates/recordPlayer.json', import.meta.url), 'utf8'));
const lobby = JSON.parse(readFileSync(new URL('../src/lib/content/templates/lobby.json', import.meta.url), 'utf8'));
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('the lobby loads the starter kit jukebox instead of building a record player', () => {
  assert.ok(!lobby.some((slot) => find(slot, 'socket')), 'the old record player socket is gone');
  assert.ok(!lobby.some((slot) => slot.id.startsWith('lobby-jukebox')));
  const loaders = buildLobbyExtras().filter((slot) => find(slot, 'loader'));
  const jukebox = loaders.find((slot) => slot.id === 'lobby-jukebox');
  assert.ok(jukebox);
  assert.deepEqual(find(jukebox, 'loader'), { type: 'loader', adapter: 'builtin', id: 'jukebox' });
  assert.ok(BUILTIN_ENTRIES.some((entry) => entry.id === 'jukebox'), 'and the starter kit has it');
  const code = find(buildLobbyExtras().find((slot) => slot.id === 'lobby-jukebox-records'), 'codeBlock').code;
  assert.doesNotThrow(() => new Function('ctx', code), 'the script that seats the discs compiles');
  for (const disc of lobby.filter((slot) => find(slot, 'insertable'))) assert.ok(code.includes(disc.id), `${disc.id} is seated in the jukebox`);
  assert.ok(code.includes('lobby-jukebox::jukebox-slot-'), 'in the places of the loaded jukebox');
});

test('the record player stays in the starter kit with a socket that takes discs', () => {
  const sockets = recordPlayer.filter((slot) => find(slot, 'socket'));
  assert.equal(sockets.length, 1);
  assert.deepEqual(find(sockets[0], 'socket').accepts, ['disc']);
  assert.deepEqual(sockets[0].scale, [1, 1, 1], 'a scaled socket would squash whatever sits in it');
});

test('every lobby disc can be grabbed and plays a bundled file, none starts inside a player', () => {
  const discs = lobby.filter((slot) => find(slot, 'insertable'));
  assert.ok(discs.length >= 2);
  for (const disc of discs) {
    assert.ok(find(disc, 'grabbable'), `${disc.name} must be grabbable`);
    assert.ok(find(disc, 'meshRenderer'), `${disc.name} needs a mesh to carry its sound`);
    assert.equal(disc.parentId, null);
    const audio = find(disc, 'audioPlayer');
    assert.equal(audio.source.kind, 'url');
    assert.ok(!audio.playing && !audio.autoplay);
    assert.ok(existsSync(new URL(`../static${audio.source.url}`, import.meta.url)), `${audio.source.url} is missing`);
  }
});

test('slot ids stay unique and the lobby needs no cloud assets', () => {
  assert.equal(new Set(lobby.map((slot) => slot.id)).size, lobby.length);
  assert.equal(collectAssetIds(lobby).size, 0);
});
