import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsRebuild } from '../src/lib/xr/slotRebuild.ts';

const slot = (components, extra = {}) => ({ id: 's', parentId: null, name: 'S', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components, ...extra });
const mesh = (id = 'box', color) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, ...(color ? { color } : {}) });

test('a transform, a name or plain data components never rebuild', () => {
  const a = slot([mesh(), { type: 'grabbable', scalable: false }]);
  assert.equal(needsRebuild(a, slot(a.components, { name: 'Other', position: [1, 2, 3] })), false);
  assert.equal(needsRebuild(a, slot([mesh(), { type: 'grabbable', scalable: true }])), false);
  assert.equal(needsRebuild(a, slot([mesh(), { type: 'grabbable', scalable: false }, { type: 'container' }])), false);
});

test('script state and script-written live fields never rebuild', () => {
  const a = slot([mesh(), { type: 'scriptState', state: { n: 1 } }, { type: 'textDisplay', text: 'a' }]);
  const b = slot([mesh(), { type: 'scriptState', state: { n: 2 } }, { type: 'textDisplay', text: 'b' }]);
  assert.equal(needsRebuild(a, b), false);
  assert.equal(needsRebuild(a, slot([mesh()])), true, 'but removing the text display itself does');
  assert.equal(needsRebuild(slot([mesh()]), slot([mesh(), { type: 'scriptState', state: {} }])), false);
});

test('a different mesh or a colour change: the mesh rebuilds, the colour is applied live', () => {
  assert.equal(needsRebuild(slot([mesh('box')]), slot([mesh('sphere')])), true);
  assert.equal(needsRebuild(slot([mesh('box', '#ff0000')]), slot([mesh('box', '#00ff00')])), false);
});

test('components that are built at spawn rebuild when their build-time fields change', () => {
  const view = (url, width) => slot([mesh('plane'), { type: 'htmlView', url, width }]);
  assert.equal(needsRebuild(view('/a', 1280), view('/b', 1280)), false, 'the url is applied live');
  assert.equal(needsRebuild(view('/a', 1280), view('/a', 640)), true);
  const code = (text) => slot([{ type: 'codeBlock', code: text }]);
  assert.equal(needsRebuild(code('a'), code('b')), true);
  assert.equal(needsRebuild(slot([mesh()]), slot([mesh(), { type: 'mirror', resolution: 512 }])), true);
});
