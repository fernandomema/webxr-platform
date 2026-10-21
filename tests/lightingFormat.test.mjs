import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER_BYTES, MAX_VOXELS, VolumeFormatError, decode, decodeTexels, encode, fromTexels, rangeFor, readHeader, toTexels } from '../packages/engine/src/lighting/format.ts';
import { nodeCodec } from '../packages/engine/src/lighting/nodeCodec.ts';
import { slotIndex, voxelCount } from '../packages/engine/src/lighting/types.ts';

const SIGNATURE = '0123456789abcdef0123456789abcdef';
function volume(dims = [5, 4, 3], fn = (f, x, y, z, c) => (f + 1) * 0.1 + x * 0.05 + y * 0.02 + z * 0.01 + c * 0.03) {
  const spec = { min: [-2.5, 0, 10], voxel: 0.25, dims };
  const data = new Float32Array(voxelCount(spec) * 6 * 3);
  for (let f = 0; f < 6; f++) for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) for (let c = 0; c < 3; c++) data[slotIndex(spec, f, x, y, z) + c] = fn(f, x, y, z, c);
  return { spec, data };
}

test('a volume survives being written and read, to within what a byte can hold', () => {
  const v = volume();
  const bytes = encode(v, SIGNATURE, nodeCodec);
  const { header, volume: back } = decode(bytes, nodeCodec);
  assert.deepEqual(header.spec, v.spec);
  assert.equal(header.signature, SIGNATURE);
  assert.equal(header.deflated, true);
  const range = rangeFor(v.data);
  let worst = 0;
  for (let i = 0; i < v.data.length; i++) worst = Math.max(worst, Math.abs(v.data[i] - back.data[i]));
  assert.ok(worst < range * 0.01, `the worst error is ${worst} of a range of ${range}`);
});

test('the dark end is kept finer than the bright end, which is what the eye needs', () => {
  const range = 4;
  const step = (v) => { const b = Math.round(255 * Math.sqrt(v / range)); return ((b + 1) / 255) ** 2 * range - (b / 255) ** 2 * range; };
  assert.ok(step(0.01) < step(2) / 5, `${step(0.01)} against ${step(2)}`);
});

test('the texels are laid out as a 3D texture of nx by ny by 6 nz wants them: x fastest, then y, then z, then the face', () => {
  const v = volume([3, 2, 2], (f, x, y, z) => (f * 100 + z * 10 + y * 3 + x) / 1000);
  const range = rangeFor(v.data);
  const texels = toTexels(v, range);
  assert.equal(texels.length, 3 * 2 * (2 * 6) * 4);
  const texel = (x, y, zd) => { const i = ((zd * 2 + y) * 3 + x) * 4; return texels[i] / 255; };
  // Face 2 is the third block of nz = 2 slices; slice 1 of it is texture depth 2 * 2 + 1.
  const expected = (2 * 100 + 1 * 10 + 1 * 3 + 2) / 1000;
  assert.ok(Math.abs(texel(2, 1, 2 * 2 + 1) ** 2 * range - expected) < range * 0.01);
  assert.equal(texels[3], 255, 'alpha is opaque');
});

test('without a codec the payload is the texels themselves', () => {
  const v = volume();
  const plain = encode(v, SIGNATURE);
  const packed = encode(v, SIGNATURE, nodeCodec);
  assert.equal(readHeader(plain).deflated, false);
  assert.ok(packed.length < plain.length, 'deflating a smooth volume saves space');
  assert.deepEqual(Array.from(decodeTexels(plain).texels), Array.from(decodeTexels(packed, nodeCodec).texels));
});

test('what is not a lighting volume, or is a damaged one, or would ask for too much memory, is refused with a clear error', () => {
  const good = encode(volume(), SIGNATURE, nodeCodec);
  const corrupt = (edit) => { const b = Uint8Array.from(good); edit(b, new DataView(b.buffer)); return b; };
  assert.throws(() => readHeader(new Uint8Array(10)), VolumeFormatError);
  assert.throws(() => readHeader(corrupt((b) => { b[0] = 0; })), /Not a lighting volume/);
  assert.throws(() => readHeader(corrupt((b) => { b[4] = 9; })), /not supported/);
  assert.throws(() => readHeader(corrupt((b, v) => { v.setUint32(8, 0, true); })), /not valid/);
  assert.throws(() => readHeader(corrupt((b, v) => { v.setFloat32(32, 0, true); })), /not valid/);
  assert.throws(() => readHeader(corrupt((b, v) => { v.setUint32(8, 2048, true); v.setUint32(12, 2048, true); v.setUint32(16, 2048, true); })), /too big|not valid/);
  assert.throws(() => readHeader(good.subarray(0, good.length - 3)), /wrong length/);
  assert.throws(() => decodeTexels(good), /needs a codec/);
  assert.throws(() => encode({ spec: { min: [0, 0, 0], voxel: 1, dims: [200, 200, 200] }, data: new Float32Array(0) }, SIGNATURE), /too big/);
  assert.ok(MAX_VOXELS > 1_000_000);
  assert.equal(good.length > HEADER_BYTES, true);
});

test('a flat black volume and a very bright one both fit a byte: the range follows the data, within limits', () => {
  assert.equal(rangeFor(new Float32Array(10)), 0.25);
  assert.equal(rangeFor(new Float32Array([100])), 16);
  assert.equal(rangeFor(new Float32Array([1.5, 0.2])), 1.5);
  const v = volume([2, 2, 2], () => 0);
  const { volume: back } = decode(encode(v, SIGNATURE, nodeCodec), nodeCodec);
  assert.ok(back.data.every((x) => x === 0));
  void fromTexels;
});
