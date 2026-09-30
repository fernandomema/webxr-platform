import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hexToHsv, hsvToHex, normalizeHex } from '../src/lib/studio/ui/color.ts';

const root = new URL('../src/lib/studio/', import.meta.url).pathname;

/** The components the in-game inspector draws. The page is rasterized without the browser's own popups and widgets, so these must not use native ones. */
const SHARED = ['Inspector', 'Hierarchy', 'FieldEditor', 'NumberInput', 'BoneMapEditor', 'PreviewCameraTools', 'ComponentCard', 'AddComponentMenu', 'WorldObjectActions'];
const FORBIDDEN = [/<select\b/, /type="color"/, /type="checkbox"/, /<datalist\b/, /\btitle=/, /<details\b/, /type="number"/];

function files() {
  const list = SHARED.map((name) => join(root, 'components', `${name}.svelte`));
  for (const entry of readdirSync(join(root, 'ui'))) if (entry.endsWith('.svelte')) list.push(join(root, 'ui', entry));
  return list;
}

test('the components shared with the XR panel use no native form popups or tooltips', () => {
  for (const file of files()) {
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue; // a listed component that does not exist (yet)
    }
    for (const pattern of FORBIDDEN) assert.doesNotMatch(source, pattern, `${file} uses ${pattern}`);
  }
});

test('colour conversion round-trips and parses short hex', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('zzz'), null);
  for (const hex of ['#ff0000', '#00ff00', '#3b82f6', '#000000', '#ffffff', '#7c6cf6']) assert.equal(hsvToHex(hexToHsv(hex)), hex);
});
