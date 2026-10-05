import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_ENTRIES, BUILTIN_FOLDERS } from '../src/lib/inventory/builtin/catalog.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';
import { paintDisc } from '../src/lib/xr/templates/recordDisc.ts';
import { TOOLS } from '../scripts/workshop-tools.mjs';
import { instantiate } from '../src/lib/ecs/serialize.ts';

test('every starter object sits in a folder, has a unique id and builds a well-formed tree', () => {
  assert.equal(new Set(BUILTIN_ENTRIES.map((entry) => entry.id)).size, BUILTIN_ENTRIES.length);
  const folders = new Set(BUILTIN_FOLDERS.map((folder) => folder.id));
  for (const entry of BUILTIN_ENTRIES) {
    assert.ok(folders.has(entry.folderId), `${entry.id} is in an unknown folder`);
    const tree = entry.build();
    const ids = tree.map((slot) => slot.id);
    assert.equal(new Set(ids).size, ids.length, `${entry.id} has repeated slot ids`);
    tree.forEach((slot, index) => {
      for (const [field, length] of [['position', 3], ['rotation', 4], ['scale', 3]]) {
        assert.equal(slot[field]?.length, length, `${entry.id}: ${slot.name} has an invalid ${field}`);
        assert.ok(slot[field].every(Number.isFinite), `${entry.id}: ${slot.name} has non-finite ${field}`);
      }
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

test('spawning an older inventory object fills missing transforms', () => {
  const tree = instantiate([{ id: 'old-tool', parentId: null, name: 'Old Tool', components: [] }]);
  assert.deepEqual(tree[0].position, [0, 0, 0]);
  assert.deepEqual(tree[0].rotation, [0, 0, 0, 1]);
  assert.deepEqual(tree[0].scale, [1, 1, 1]);
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

test('the Starter Kit includes every workshop tool with its model and script', () => {
  assert.equal(BUILTIN_ENTRIES.filter((entry) => entry.name === 'Paint Brush').length, 1);
  for (const tool of TOOLS) {
    const entry = BUILTIN_ENTRIES.find((candidate) => candidate.id === tool.id);
    assert.ok(entry, `${tool.id} is missing from the Starter Kit`);
    const tree = entry.build();
    assert.ok(tree[0].components.some((component) => component.type === 'codeBlock'));
    assert.ok(tree[0].components.some((component) => component.type === 'equippable'));
    assert.equal(tree.filter((slot) => slot.parentId === tree[0].id).length, tool.parts.length);
    const originalPosition = entry.build()[1].position.slice();
    tree[1].position[0] += 1;
    assert.deepEqual(entry.build()[1].position, originalPosition);
  }
});

test('the furniture, lighting and decor are whole objects standing on the floor', () => {
  const folders = ['furniture', 'lighting', 'decor'];
  const entries = BUILTIN_ENTRIES.filter((entry) => folders.includes(entry.folderId));
  assert.ok(entries.length >= 15);
  for (const entry of entries) {
    const tree = entry.build();
    assert.ok(tree.length > 2, `${entry.id} should be made of several parts`);
    for (const slot of tree.slice(1)) {
      const mesh = slot.components.find((c) => c.type === 'meshRenderer');
      assert.ok(mesh, `${entry.id}: ${slot.name} has no mesh`);
      assert.ok(slot.scale.every((v) => v > 0), `${entry.id}: ${slot.name} has a flat scale`);
    }
    const lowest = Math.min(...tree.slice(1).map((slot) => slot.position[1] - (slot.components.some((c) => c.meshRef?.id === 'disc' || c.meshRef?.id === 'plane') || slot.rotation[0] !== 0 ? 0 : slot.scale[1] / 2)));
    assert.ok(lowest > -0.01 && lowest < 0.03, `${entry.id} should rest on y=0, lowest is ${lowest}`);
  }
  for (const id of ['floor-lamp', 'table-lamp', 'lantern', 'neon-sign']) {
    assert.ok(BUILTIN_ENTRIES.find((e) => e.id === id).build().some((slot) => slot.components.some((c) => c.type === 'pointLight')), `${id} should give light`);
  }
});

test('the home-building tools sit in a Home Builder folder inside Tools', async () => {
  const { builtinInventoryAdapter } = await import('../src/lib/inventory/adapters/builtin.ts');
  const top = await builtinInventoryAdapter.listFolders({}, null);
  assert.ok(top.some((folder) => folder.id === 'tools'));
  assert.ok(!top.some((folder) => folder.id === 'home-builder'), 'a subfolder is not listed at the top');
  const inTools = await builtinInventoryAdapter.listFolders({}, 'tools');
  assert.deepEqual(inTools.map((folder) => folder.name), ['Home Builder']);
  const home = (await builtinInventoryAdapter.listItems({}, 'home-builder')).map((item) => item.name);
  for (const name of ['Wall Tool', 'Floor Tool', 'Stairs Tool', 'Door & Window Tool', 'Roof Tool', 'Sledgehammer']) assert.ok(home.includes(name), `${name} is in Home Builder`);
  const loose = (await builtinInventoryAdapter.listItems({}, 'tools')).map((item) => item.name);
  assert.ok(!loose.includes('Wall Tool') && loose.includes('Drill') && loose.includes('Camera'));
});
