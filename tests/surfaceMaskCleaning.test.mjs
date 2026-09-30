import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lobby = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/lobby.json', import.meta.url), 'utf8'));
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('the lobby dirty cube starts fully covered by a grime surfaceMask, sized for its box face atlas', () => {
  const cube = lobby.find((slot) => find(slot, 'surfaceMask'));
  assert.ok(cube, 'expected a slot with a surfaceMask component');
  const mask = find(cube, 'surfaceMask');
  assert.ok(mask.resolution > 0);
  const meshRef = find(cube, 'meshRenderer')?.meshRef;
  assert.ok(meshRef?.kind === 'builtin' && meshRef.id === 'box', 'the dirty cube should be a box (each face gets its own atlas cell)');
  const bytes = Buffer.from(mask.mask, 'base64');
  // A box host is a 3x2 face atlas (see surfaceMaskRenderer.ts) so each face
  // cleans independently instead of one UV square being shared by all 6.
  assert.equal(bytes.length, mask.resolution * 3 * mask.resolution * 2, 'a box mask must be sized for a 3x2 face atlas, not a single resolution*resolution square');
  assert.ok([...bytes].every((b) => b === 255), 'a fresh coating starts fully covered');
});

test('the lobby pressure washer is a grabbable, equippable tool that aims with a generic raycast and paints the mask it hits', () => {
  const washer = lobby.find((slot) => slot.name === 'Pressure Washer');
  assert.ok(washer, 'expected a "Pressure Washer" slot');
  assert.ok(find(washer, 'grabbable'));
  assert.ok(find(washer, 'equippable'));
  const code = find(washer, 'codeBlock');
  assert.ok(code && code.code.length > 0);
  assert.match(code.code, /findByName\('Washer Nozzle'\)/);
  assert.match(code.code, /ctx\.world\.raycast\(/, 'should aim with the generic raycast primitive, not a fixed-distance guess');
  assert.match(code.code, /setComponentField\(hit\.slotId, 'surfaceMask', 'mask'/);
  assert.match(code.code, /faceIndexFromNormal/, 'a box target has 6 faces sharing one UV square by default, so cleaning must resolve which face was actually hit');
  assert.match(code.code, /type: 'stroke'/, 'the water jet itself should be visibly rendered, not just its effect on the target');

  const nozzle = lobby.find((slot) => slot.parentId === washer.id && slot.name === 'Washer Nozzle');
  assert.ok(nozzle, 'the washer needs a "Washer Nozzle" child slot for the codeBlock to aim from');
});

test('slot ids stay unique with the washer/surfaceMask entities added', () => {
  assert.equal(new Set(lobby.map((slot) => slot.id)).size, lobby.length);
});
