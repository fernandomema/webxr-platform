import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDisc, readDisc, paintDisc } from '../src/lib/xr/templates/recordDisc.ts';
import { reduceDocOp } from '../src/lib/studio/state/docOps.ts';

const lobby = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/lobby.json', import.meta.url), 'utf8'));
const params = { id: 'd', title: 'Night Drive', author: 'Someone', labelColor: '#7c3aed', source: { kind: 'url', url: '/audio/x.mp3' } };
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('a disc is built from its parameters and reads back the same', () => {
  const slots = buildDisc(params);
  assert.equal(slots[0].id, 'd');
  assert.ok(slots.slice(1).every((slot) => slot.parentId === 'd'));
  assert.deepEqual(readDisc(slots, 'd'), { id: 'd', title: 'Night Drive', author: 'Someone', labelColor: '#7c3aed', vinylColor: '#0b0b10' });
  assert.equal(find(slots[0], 'audioPlayer').playing, undefined);
  assert.equal(find(buildDisc(params, { playing: true })[0], 'audioPlayer').playing, true);
});

const setField = (tree, id, key, value) => {
  const index = tree.find((slot) => slot.id === id).components.findIndex((c) => c.type === 'recordDisc');
  return reduceDocOp(tree, { op: 'setField', id, index, key, value }).tree;
};

test('editing the recordDisc fields redraws title, author and colours everywhere they appear and nothing else', () => {
  const placed = buildDisc(params, { parentId: 'socket', position: [1, 2, 3], playing: true });
  let next = placed;
  for (const [key, value] of [['title', 'Dawn'], ['author', 'Other'], ['labelColor', '#ef4444'], ['vinylColor', '#7f1d1d']]) next = setField(next, 'd', key, value);
  assert.deepEqual(readDisc(next, 'd'), { id: 'd', title: 'Dawn', author: 'Other', labelColor: '#ef4444', vinylColor: '#7f1d1d' });
  assert.equal(next[0].name, 'Disc: Dawn');
  assert.equal(next[0].parentId, 'socket');
  assert.deepEqual(next[0].position, [1, 2, 3]);
  assert.equal(find(next[0], 'audioPlayer').playing, true);
  // Same as building it that way from scratch.
  const fresh = buildDisc({ ...params, title: 'Dawn', author: 'Other', labelColor: '#ef4444', vinylColor: '#7f1d1d' }, { parentId: 'socket', position: [1, 2, 3], playing: true });
  assert.deepEqual(next, fresh);
});

test('painting leaves untouched slots as the very same objects, and other slots and fields alone', () => {
  const slots = [...buildDisc(params), { id: 'other', parentId: null, name: 'Other', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] }];
  assert.equal(paintDisc(slots, 'missing'), slots);
  const next = setField(slots, 'd', 'title', 'Dawn');
  assert.equal(next.at(-1), slots.at(-1));
  assert.equal(next.find((slot) => slot.id === 'd-rim'), slots.find((slot) => slot.id === 'd-rim'), 'a title change does not repaint the rim');
  assert.notEqual(next.find((slot) => slot.id === 'd-label-text'), slots.find((slot) => slot.id === 'd-label-text'));
});

test('a duplicated disc (all ids new) still repaints from its own fields', () => {
  const slots = buildDisc(params);
  const copy = reduceDocOp(slots, { op: 'duplicate', id: 'd', nonce: 'n' });
  const next = setField(copy.tree, copy.selectId, 'labelColor', '#ef4444');
  const paintedColours = next.filter((slot) => slot.parentId === copy.selectId && ['Disc Label', 'Disc Rim'].includes(slot.name)).map((slot) => find(slot, 'meshRenderer').color);
  assert.deepEqual(paintedColours, ['#ef4444', '#ef4444']);
  assert.equal(find(next.find((slot) => slot.id === 'd-label'), 'meshRenderer').color, '#7c3aed', 'the original is untouched');
});

test('every disc in the lobby is exactly what buildDisc makes from its readable parameters', () => {
  const discs = lobby.filter((slot) => find(slot, 'insertable'));
  assert.ok(discs.length >= 2);
  for (const root of discs) {
    const read = readDisc(lobby, root.id);
    assert.ok(read, `${root.id} must be readable`);
    const audio = find(root, 'audioPlayer');
    const rebuilt = buildDisc({ ...read, source: audio.source }, { parentId: root.parentId, position: root.position, rotation: root.rotation, playing: !!audio.playing });
    const actual = lobby.filter((slot) => slot.id === root.id || slot.parentId === root.id);
    assert.deepEqual(actual, rebuilt, `${root.id} drifted from the disc generator`);
  }
});
