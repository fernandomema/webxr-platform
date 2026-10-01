import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorldManifest, describeWorldApp, findAppInfo, parseIconName, parseScreenshotName } from '../src/lib/worlds/appManifest.ts';
import { collectAssetIds } from '../src/lib/assets/ref.ts';

const ICON = `sha256:${'a'.repeat(64)}`;
const scene = [
  { id: 'a', parentId: null, name: 'Root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] },
  { id: 'b', parentId: null, name: 'App', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [
    { type: 'appInfo', name: ' Space Golf ', description: 'Putt among the stars', icon: { kind: 'asset', assetId: ICON }, themeColor: '#112233' }
  ] }
];

test('finds the appInfo component anywhere in the scene', () => {
  assert.equal(findAppInfo(scene)?.name, ' Space Golf ');
  assert.equal(findAppInfo([scene[0]]), null);
});

test('an app descriptor falls back to the world name and a default colour', () => {
  assert.deepEqual(describeWorldApp('Plain world', null), { name: 'Plain world', shortName: 'Plain world', description: '', themeColor: '#0b1030', backgroundColor: '#0b1030' });
  const described = describeWorldApp('Plain world', findAppInfo(scene));
  assert.equal(described.name, 'Space Golf');
  assert.equal(described.themeColor, '#112233');
  assert.equal(described.backgroundColor, '#112233');
  assert.equal(describeWorldApp('x', { type: 'appInfo', themeColor: 'red' }).themeColor, '#0b1030');
});

test('each world manifest is scoped to its own app URL', () => {
  const manifest = buildWorldManifest('w1', describeWorldApp('W', null), 'rev9');
  assert.equal(manifest.start_url, '/play/w1');
  assert.equal(manifest.scope, '/play/w1/');
  assert.equal(manifest.id, '/play/w1');
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ['/play/w1/icon/192.png?v=rev9', '/play/w1/icon/512.png?v=rev9', '/play/w1/icon/512-maskable.png?v=rev9']);
});

test('icon names are validated', () => {
  assert.deepEqual(parseIconName('512-maskable.png'), { size: 512, maskable: true });
  assert.deepEqual(parseIconName('192.png'), { size: 192, maskable: false });
  assert.equal(parseIconName('64.png'), null);
  assert.equal(parseIconName('../512.png'), null);
});

test('the app icon counts as an asset the world uses', () => {
  assert.deepEqual([...collectAssetIds(scene)], [ICON]);
});

test('a world manifest has a screenshot for mobile and one for wide screens', () => {
  const { screenshots } = buildWorldManifest('w1', describeWorldApp('W', null), 'r');
  assert.ok(screenshots.some((shot) => shot.form_factor !== 'wide'));
  assert.ok(screenshots.some((shot) => shot.form_factor === 'wide'));
  assert.deepEqual(parseScreenshotName('screenshot-narrow.png'), { width: 720, height: 1280 });
  assert.equal(parseScreenshotName('screenshot-tall.png'), null);
});
