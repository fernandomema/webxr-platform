import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bake, bakeDetailed, bakeSettingsKey, specFor } from '../packages/engine/src/lighting/bake.ts';
import { bakeParallel } from '../packages/engine/src/lighting/parallel.ts';
import { analyzeVolume, sliceImage } from '../packages/engine/src/lighting/qa.ts';
import { encodePng } from '../packages/engine/src/lighting/nodePng.ts';
import { compose, invert } from '../packages/engine/src/lighting/matrix.ts';
import { worldBounds } from '../packages/engine/src/lighting/primitives.ts';
import { extractScene, sceneSignature } from '../packages/engine/src/lighting/sceneExtract.ts';
import { serializeFragment, parseFragment } from '../packages/engine/src/assets/fragment.ts';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { inflateSync } from 'node:zlib';

const SKY = { top: [0.4, 0.5, 0.6], horizon: [0.3, 0.3, 0.3], bottom: [0.1, 0.1, 0.1], intensity: 1 };
const prim = (shape, position, scale, albedo = [0.6, 0.6, 0.6]) => {
  const world = compose(position, [0, 0, 0, 1], scale);
  return { id: `${shape}-${position}`, shape, world, inverse: invert(world), albedo, emissive: null, opaque: true, ...worldBounds(shape, world) };
};
const point = (position, color = [1, 1, 1], range = 10) => ({ kind: 'point', position, direction: [0, -1, 0], color, range, cosHalfAngle: -1, exponent: 0 });
const scene = (extra = []) => ({ primitives: [prim('box', [2, -0.15, 2], [5, 0.3, 5]), prim('box', [2, 1.5, 2], [1, 3, 1]), ...extra], lights: [point([0.5, 2, 0.5], [2, 1.6, 1.2])], sky: SKY });
const OPTIONS = { samples: 24, passes: 2, blur: 1 };

test('baking over several threads gives exactly the volume of baking on one', async () => {
  const spec = specFor([-0.5, 0, -0.5], [4.5, 3, 4.5], 0.5);
  const serial = bake(scene(), spec, OPTIONS);
  const seen = [];
  const { volume } = await bakeParallel(scene(), spec, { ...OPTIONS, threads: 3, chunk: 2, progress: (f) => seen.push(f) });
  assert.equal(volume.data.length, serial.data.length);
  assert.ok(volume.data.every((v, i) => v === serial.data[i]), 'the same, to the last bit');
  assert.ok(seen.length > 0 && seen.at(-1) <= 1 && seen.every((v, i) => i === 0 || v >= seen[i - 1] - 1e-9), 'with progress that only goes forwards');
  const one = await bakeParallel(scene(), spec, { ...OPTIONS, threads: 1 });
  assert.ok(one.volume.data.every((v, i) => v === serial.data[i]), 'and so does one thread of the parallel baker');
});

test('a volume is measured: smooth, grainy and leaky ones are told apart, in words', () => {
  const spec = specFor([-0.5, 0, -0.5], [4.5, 3, 4.5], 0.5);
  const good = bakeDetailed(scene(), spec, { samples: 96, passes: 2, blur: 2 });
  const q = analyzeVolume(good.volume, good.plan);
  assert.ok(q.free > 0 && q.free < q.voxels, 'the pillar and the floor are solid');
  assert.ok(q.luminance.mean > 0 && q.luminance.p95 >= q.luminance.p50 && q.luminance.max >= q.luminance.p95);
  const grainy = bakeDetailed(scene(), spec, { samples: 4, passes: 1, blur: 0 });
  assert.ok(analyzeVolume(grainy.volume, grainy.plan).noise > q.noise, 'fewer samples and no smoothing is grainier');
  // A wall a tenth of a voxel thick passes through cells whose centres are free.
  const thin = bakeDetailed(scene([prim('box', [1.2, 1, 3.1], [3, 2, 0.05])]), spec, OPTIONS);
  const quality = analyzeVolume(thin.volume, thin.plan);
  assert.ok(quality.straddling > 0 && quality.warnings.some((w) => /thin wall/.test(w)), quality.warnings.join('|'));
  assert.equal(analyzeVolume(good.volume, good.plan).straddling < quality.straddling, true);
  const dark = bakeDetailed({ primitives: [prim('box', [2, -0.15, 2], [5, 0.3, 5])], lights: [], sky: { ...SKY, intensity: 0 } }, spec, OPTIONS);
  assert.ok(analyzeVolume(dark.volume, dark.plan).warnings.some((w) => /almost no light/.test(w)) || analyzeVolume(dark.volume, dark.plan).luminance.max === 0);
});

test('a slice of a volume is a picture: the right size, with the solids marked, and it encodes to a PNG that reads back', () => {
  const spec = specFor([-0.5, 0, -0.5], [4.5, 3, 4.5], 0.5);
  const { volume, plan } = bakeDetailed(scene(), spec, OPTIONS);
  const image = sliceImage(volume, plan, { scale: 3 });
  assert.equal(image.rgba.length, image.width * image.height * 4);
  assert.ok(image.rgba.some((v, i) => i % 4 === 0 && v === 58), 'solids are blue-grey');
  const png = encodePng(image.rgba, image.width, image.height);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  assert.equal(view.getUint32(16), image.width);
  assert.equal(view.getUint32(20), image.height);
  const idatLength = view.getUint32(33);
  assert.equal(String.fromCharCode(...png.subarray(37, 41)), 'IDAT');
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  assert.equal(raw.length, (image.width * 4 + 1) * image.height);
});

test('the signature of a region follows its scene and its bake settings, and a fragment is baked in where it is switched on', () => {
  const grid = { min: [0, 0, 0], voxel: 0.5, dims: [4, 4, 4] };
  const reach = { min: [0, 0, 0], max: [2, 2, 2] };
  const a = extractScene([createSlot({ id: 'f', name: 'f', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }] })]);
  const sig = (s, settings) => sceneSignature(s, grid, reach, 24, settings);
  assert.equal(sig(a), sig(a));
  assert.notEqual(sig(a, bakeSettingsKey({ samples: 8 })), sig(a, bakeSettingsKey({ samples: 160 })), 'baking with other settings is a different bake');
  const fragmentId = `sha256:${'c'.repeat(64)}`;
  const data = parseFragment(serializeFragment([createSlot({ id: 'wall', name: 'wall', position: [1, 1, 1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] })]));
  const owner = { ...createSlot({ id: 'map', name: 'map', position: [10, 0, 0], components: [{ type: 'fragment', source: { kind: 'asset', assetId: fragmentId } }] }) };
  assert.equal(extractScene([owner]).primitives.length, 0, 'without the fragment there is nothing');
  const withIt = extractScene([owner], { fragments: () => data });
  assert.equal(withIt.primitives.length, 1);
  assert.ok(Math.abs(withIt.primitives[0].world[12] - 11) < 1e-6, 'placed relative to the slot that loads it');
  assert.equal(extractScene([{ ...owner, disabled: true }], { fragments: () => data }).primitives.length, 0, 'a switched-off fragment is not part of the lighting');
});
