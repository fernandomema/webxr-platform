import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ENTRIES, BUILTIN_FOLDERS } from '../src/lib/inventory/builtin/catalog.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';
import { paintDisc } from '../src/lib/xr/templates/recordDisc.ts';

test('every starter object sits in a folder, has a unique id and builds a well-formed tree', () => {
  assert.equal(new Set(BUILTIN_ENTRIES.map((entry) => entry.id)).size, BUILTIN_ENTRIES.length);
  const folders = new Set(BUILTIN_FOLDERS.map((folder) => folder.id));
  for (const entry of BUILTIN_ENTRIES) {
    assert.ok(folders.has(entry.folderId), `${entry.id} is in an unknown folder`);
    const tree = entry.build();
    const ids = tree.map((slot) => slot.id);
    assert.equal(new Set(ids).size, ids.length, `${entry.id} has repeated slot ids`);
    tree.forEach((slot, index) => {
      if (slot.parentId) assert.ok(ids.indexOf(slot.parentId) >= 0 && ids.indexOf(slot.parentId) < index, `${entry.id}: ${slot.name} comes before its parent`);
    });
    assert.equal(tree.filter((slot) => slot.parentId === null).length, 1, `${entry.id} must be a single object`);
    assert.ok(tree[0].components.some((c) => c.type === 'grabbable'), `${entry.id}: the root must be grabbable`);
    assert.equal(collectAssetIds(tree).size, 0, `${entry.id} must not need cloud assets`);
  }
});

test('building twice gives separate copies', () => {
  const entry = BUILTIN_ENTRIES[0];
  const a = entry.build();
  a[0].name = 'changed';
  assert.notEqual(entry.build()[0].name, 'changed');
});

test('the record player starts empty and is centred on its own origin; the brush is at the origin', () => {
  const player = BUILTIN_ENTRIES.find((entry) => entry.id === 'record-player').build();
  const socket = player.find((slot) => slot.components.some((c) => c.type === 'socket'));
  assert.equal(socket.components.find((c) => c.type === 'socket').occupantId, undefined);
  const base = player.find((slot) => slot.name === 'Record Player Base');
  assert.deepEqual([base.position[0], base.position[2]], [0, 0]);
  assert.deepEqual(BUILTIN_ENTRIES.find((entry) => entry.id === 'paint-brush').build()[0].position, [0, 0, 0]);
});

test('the starter discs are real discs: painting them changes nothing', () => {
  for (const entry of BUILTIN_ENTRIES.filter((e) => e.folderId === 'music' && e.id.includes('disc') && e.id !== 'disc-rack')) {
    const tree = entry.build();
    assert.deepEqual(paintDisc(tree, tree[0].id), tree);
  }
});

test('the camera has a screen that looks out of the lens side of its body', () => {
  const tree = BUILTIN_ENTRIES.find((entry) => entry.id === 'camera').build();
  const screen = tree.find((slot) => slot.name === 'Camera Screen');
  assert.ok(screen.components.some((c) => c.type === 'camera'));
  assert.ok(screen.components.some((c) => c.type === 'meshRenderer'));
  assert.ok(tree[0].components.some((c) => c.type === 'equippable'));
  assert.ok(tree.find((slot) => slot.name === 'Camera Lens').position[2] > 0 && screen.position[2] < 0);
});
