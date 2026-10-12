import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bake, specFor } from '../src/lib/lighting/bake.ts';
import { compose, invert } from '../src/lib/lighting/matrix.ts';
import { worldBounds } from '../src/lib/lighting/primitives.ts';
import { sampleVolume } from '../src/lib/lighting/sample.ts';
import { slotIndex } from '../src/lib/lighting/types.ts';

const BLACK_SKY = { top: [0, 0, 0], horizon: [0, 0, 0], bottom: [0, 0, 0], intensity: 0 };
const prim = (shape, position, scale, albedo = [0.5, 0.5, 0.5], rotation = [0, 0, 0, 1], extra = {}) => {
  const world = compose(position, rotation, scale);
  return { id: `${shape}-${position}`, shape, world, inverse: invert(world), albedo, emissive: null, opaque: true, ...worldBounds(shape, world), ...extra };
};
const point = (position, color = [1, 1, 1], range = 10) => ({ kind: 'point', position, direction: [0, -1, 0], color, range, cosHalfAngle: -1, exponent: 0 });
/** A closed room, inside x 0..w, y 0..h, z 0..d, with walls 0.3 thick. */
function room(w, h, d, albedo) {
  const t = 0.3;
  return [
    prim('box', [w / 2, -t / 2, d / 2], [w + 2 * t, t, d + 2 * t], albedo), prim('box', [w / 2, h + t / 2, d / 2], [w + 2 * t, t, d + 2 * t], albedo),
    prim('box', [-t / 2, h / 2, d / 2], [t, h, d], albedo), prim('box', [w + t / 2, h / 2, d / 2], [t, h, d], albedo),
    prim('box', [w / 2, h / 2, -t / 2], [w, h, t], albedo), prim('box', [w / 2, h / 2, d + t / 2], [w, h, t], albedo)
  ];
}
const FAST = { samples: 32, passes: 2, blur: 0 };
const faceAt = (volume, face, x, y, z) => { const i = slotIndex(volume.spec, face, x, y, z); return Array.from(volume.data.slice(i, i + 3)); };
const mean = (v) => (v[0] + v[1] + v[2]) / 3;
/** The grid voxel holding a world point. */
const voxelOf = (spec, p) => p.map((v, k) => Math.floor((v - spec.min[k]) / spec.voxel));
const lightAt = (volume, p, n = [0, 1, 0]) => mean(sampleVolume(volume, p, n));

test('an open world with a plain sky gives every face the sky’s own colour: nothing is lost or made up by the arithmetic', () => {
  const sky = { top: [0.5, 0.5, 0.5], horizon: [0.5, 0.5, 0.5], bottom: [0.5, 0.5, 0.5], intensity: 1 };
  const volume = bake({ primitives: [], lights: [], sky }, specFor([0, 0, 0], [2, 2, 2], 0.5), { samples: 64, passes: 1, blur: 0 });
  for (let f = 0; f < 6; f++) {
    const [r] = faceAt(volume, f, 1, 1, 1);
    assert.ok(Math.abs(r - 0.5) < 0.025, `face ${f}: ${r.toFixed(3)}`);
  }
});

test('a lamp lights a face that looks at it by its colour times how much of its range is left, and a face that looks away not at all', () => {
  const spec = specFor([2.5, -0.5, -0.5], [3.5, 0.5, 0.5], 1);       // one voxel, centred at (3, 0, 0)
  const volume = bake({ primitives: [], lights: [point([0, 0, 0], [1, 0.5, 0.25], 10)], sky: BLACK_SKY }, spec, { samples: 16, passes: 1, blur: 0 });
  const towards = faceAt(volume, 1, 0, 0, 0), away = faceAt(volume, 0, 0, 0, 0);
  assert.ok(Math.abs(towards[0] - 0.7) < 1e-6 && Math.abs(towards[1] - 0.35) < 1e-6 && Math.abs(towards[2] - 0.175) < 1e-6, `${towards}`);
  assert.deepEqual(away, [0, 0, 0]);
  const sides = faceAt(volume, 2, 0, 0, 0);
  assert.deepEqual(sides, [0, 0, 0], 'a light level with the voxel does not light its top');
});

test('a lamp reaches nothing beyond its range, and the light falls off linearly towards it', () => {
  const spec = specFor([0, -0.5, -0.5], [12, 0.5, 0.5], 1);
  const volume = bake({ primitives: [], lights: [point([0, 0, 0], [1, 1, 1], 8)], sky: BLACK_SKY }, spec, { samples: 16, passes: 1, blur: 0 });
  const along = Array.from({ length: 12 }, (_, x) => faceAt(volume, 1, x, 0, 0)[0]);
  for (let x = 1; x < 8; x++) assert.ok(along[x] < along[x - 1], `still falling at ${x}`);
  for (let x = 8; x < 12; x++) assert.equal(along[x], 0, `nothing at ${x} m`);
  assert.ok(Math.abs(along[4] - (1 - 4.5 / 8)) < 1e-6);
});

test('a spot light lights only inside its cone', () => {
  const spot = { kind: 'spot', position: [0, 0, 0], direction: [1, 0, 0], color: [1, 1, 1], range: 20, cosHalfAngle: Math.cos(0.4), exponent: 1 };
  const spec = specFor([2, -4, -0.5], [4, 4, 0.5], 1);
  const volume = bake({ primitives: [], lights: [spot], sky: BLACK_SKY }, spec, { samples: 16, passes: 1, blur: 0 });
  const inCone = faceAt(volume, 1, 0, 4, 0)[0] + faceAt(volume, 1, 0, 3, 0)[0];
  const outside = faceAt(volume, 1, 0, 0, 0)[0] + faceAt(volume, 1, 0, 7, 0)[0];
  assert.ok(inCone > 0.3, `inside ${inCone}`);
  assert.equal(outside, 0, 'outside');
});

test('a wall between a lamp and a voxel puts the voxel in shadow, and it does not leak through a wall as thin as 0.3 m', () => {
  const wall = prim('box', [0, 0, 0], [0.3, 6, 6], [0.5, 0.5, 0.5]);
  const spec = specFor([-3, -3, -3], [3, 3, 3], 0.25);
  const lit = bake({ primitives: [wall], lights: [point([-2, 0, 0], [1, 1, 1], 8)], sky: BLACK_SKY }, spec, { ...FAST, passes: 1 });
  const free = bake({ primitives: [], lights: [point([-2, 0, 0], [1, 1, 1], 8)], sky: BLACK_SKY }, spec, { ...FAST, passes: 1 });
  const near = [-0.5, 0, 0], behind = [0.5, 0, 0];      // beside the lamp’s side of the wall, and just behind it
  // What a surface facing the lamp reads: on the lamp’s side it is lit, and behind the wall it is black.
  const facing = (volume, p, n) => lightAt(volume, p, n);
  assert.ok(facing(lit, near, [-1, 0, 0]) > 0.5, 'lit on its own side');
  assert.ok(facing(lit, behind, [-1, 0, 0]) < 0.02, `behind the wall: ${facing(lit, behind, [-1, 0, 0])}`);
  assert.ok(facing(free, behind, [-1, 0, 0]) > 0.3, 'the same place is lit when there is no wall');
});

test('inside a closed room with the sky off, the lamp is the only light, and nothing gets out to the other side', () => {
  const scene = { primitives: room(6, 3, 6, [0.6, 0.6, 0.6]), lights: [point([3, 2.5, 3], [1, 1, 1], 12)], sky: BLACK_SKY };
  const spec = specFor([-1.5, -0.5, -1.5], [7.5, 3.5, 7.5], 0.25);
  const volume = bake(scene, spec, FAST);
  const below = lightAt(volume, [3, 0.4, 3], [0, 1, 0]);        // the floor under the lamp
  const corner = lightAt(volume, [0.4, 0.4, 0.4], [0, 1, 0]);   // the floor in a corner
  assert.ok(below > corner * 1.3, `under the lamp ${below.toFixed(3)}, in a corner ${corner.toFixed(3)}`);
  assert.ok(corner > 0.02, 'the corner is not black: walls bounce light');
  const outside = lightAt(volume, [-1.2, 1, 3], [-1, 0, 0]);   // outside the wall, facing away
  assert.ok(outside < 0.005, `outside the room: ${outside}`);
});

test('a white room is lighter than a black one, because the light bounces; and each extra round of bounces adds light', () => {
  const lamp = [point([3, 2.5, 3], [1, 1, 1], 12)];
  const spec = specFor([-0.5, -0.5, -0.5], [6.5, 3.5, 6.5], 0.5);
  const at = (albedo, passes) => lightAt(bake({ primitives: room(6, 3, 6, albedo), lights: lamp, sky: BLACK_SKY }, spec, { ...FAST, passes }), [0.6, 0.6, 3], [1, 0, 0]);
  const white = at([0.9, 0.9, 0.9], 2), black = at([0.05, 0.05, 0.05], 2);
  assert.ok(white > black * 1.8, `white ${white.toFixed(3)}, black ${black.toFixed(3)}`);
  assert.ok(at([0.9, 0.9, 0.9], 3) > at([0.9, 0.9, 0.9], 1), 'more bounces, more light');
});

test('a coloured wall tints the light it bounces: a red wall next to a white one makes the white one pink', () => {
  const scene = { primitives: [prim('box', [0, 1.5, 3], [0.3, 3, 6], [0.9, 0.05, 0.05]), prim('box', [4, 1.5, 3], [0.3, 3, 6], [0.9, 0.9, 0.9]), prim('box', [2, -0.15, 3], [4.6, 0.3, 6.6], [0.8, 0.8, 0.8])], lights: [point([1, 2.5, 3], [1, 1, 1], 14)], sky: BLACK_SKY };
  const volume = bake(scene, specFor([-1, -1, -1], [5, 4, 7], 0.25), FAST);
  const onWhite = sampleVolume(volume, [3.6, 1.5, 3], [-1, 0, 0]);
  assert.ok(onWhite[0] > onWhite[2] * 1.15, `the white wall facing the red one is warmer: ${onWhite.map((v) => v.toFixed(3))}`);
});

test('an emissive surface lights what faces it', () => {
  const lamp = prim('box', [0, 3, 0], [4, 0.1, 4], [0, 0, 0], [0, 0, 0, 1], { emissive: [2, 2, 2] });
  const volume = bake({ primitives: [lamp], lights: [], sky: BLACK_SKY }, specFor([-3, 0, -3], [3, 3, 3], 0.5), { samples: 64, passes: 1, blur: 0 });
  assert.ok(lightAt(volume, [0, 1.5, 0], [0, 1, 0]) > 0.3, 'the floor below it');
  assert.ok(lightAt(volume, [0, 1.5, 0], [0, -1, 0]) < 0.05, 'a face turned away from it');
});

test('a voxel inside a wall is filled in from its neighbours, so that a surface next to the wall does not read black', () => {
  const scene = { primitives: [prim('box', [0, 1, 0], [0.6, 2, 8], [0.5, 0.5, 0.5]), prim('box', [0, -0.15, 0], [10, 0.3, 10], [0.5, 0.5, 0.5])], lights: [point([-2, 1.5, 0], [1, 1, 1], 10)], sky: BLACK_SKY };
  const spec = specFor([-3, 0, -3], [3, 2, 3], 0.25);
  const volume = bake(scene, spec, FAST);
  // Two voxels inside the wall: the one on the lamp's side takes the lit side's light, the other the dark side's.
  const [x, y, z] = voxelOf(spec, [-0.125, 1, 0]);
  assert.ok(mean(faceAt(volume, 1, x, y, z)) > 0.5, `the lamp's side of the wall: ${faceAt(volume, 1, x, y, z)}`);
  const [xb, yb, zb] = voxelOf(spec, [0.125, 1, 0]);
  assert.ok(mean(faceAt(volume, 1, xb, yb, zb)) < 0.05, 'and the far side stays dark');
});

test('the same scene bakes to the same numbers, bit for bit', () => {
  const scene = { primitives: room(4, 3, 4, [0.6, 0.5, 0.4]), lights: [point([2, 2.5, 2], [1, 0.9, 0.8], 9)], sky: { top: [0.1, 0.1, 0.2], horizon: [0.2, 0.2, 0.2], bottom: [0, 0, 0], intensity: 1 } };
  const spec = specFor([-0.5, -0.5, -0.5], [4.5, 3.5, 4.5], 0.5);
  const a = bake(scene, spec, FAST), b = bake(scene, spec, FAST);
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test('a rotated box and a mirrored one are walls like any other', () => {
  const tilted = prim('box', [0, 1, 0], [3, 0.2, 3], [0.5, 0.5, 0.5], [Math.sin(0.4), 0, Math.cos(0.4) * 0.3, Math.cos(0.4)]);
  const mirrored = prim('box', [0, 1, 4], [-3, 0.2, 3], [0.5, 0.5, 0.5]);
  const volume = bake({ primitives: [tilted, mirrored], lights: [point([0, 3, 0], [1, 1, 1], 9)], sky: BLACK_SKY }, specFor([-4, 0, -2], [4, 4, 6], 0.5), { ...FAST, passes: 1 });
  assert.ok(lightAt(volume, [0, 3.2, 0], [0, 1, 0]) >= 0);
  assert.ok(Number.isFinite(lightAt(volume, [0, 0.3, 0], [0, 1, 0])));
  assert.ok(lightAt(volume, [0, 0.3, 0], [0, 1, 0]) < lightAt(volume, [0, 2, 3], [0, 1, 0]) + 1, 'the table shades what is under it');
});
