import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderView } from '../src/lib/worlds/panoramaProjection.ts';

// A 360x180 picture: red on the left half of the horizon, blue on the right half, green above the horizon.
function picture() {
  const width = 360, height = 180;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const colour = y < height / 4 ? [0, 255, 0] : x < width / 2 ? [255, 0, 0] : [0, 0, 255];
    data.set([...colour, 255], i);
  }
  return { width, height, data };
}
const centre = (out, w, h) => [...out.slice(((h >> 1) * w + (w >> 1)) * 4, ((h >> 1) * w + (w >> 1)) * 4 + 3)];

test('looking straight ahead shows the middle of the picture', () => {
  const out = new Uint8ClampedArray(32 * 18 * 4);
  renderView(picture(), out, 32, 18, 0.1, 0, Math.PI / 2);
  assert.deepEqual(centre(out, 32, 18), [0, 0, 255]);
  renderView(picture(), out, 32, 18, -0.1, 0, Math.PI / 2);
  assert.deepEqual(centre(out, 32, 18), [255, 0, 0]);
});

test('turning right moves towards the right of the picture, and the view wraps around 360 degrees', () => {
  const out = new Uint8ClampedArray(32 * 18 * 4);
  renderView(picture(), out, 32, 18, Math.PI / 2, 0, Math.PI / 2);
  assert.deepEqual(centre(out, 32, 18), [0, 0, 255]);
  renderView(picture(), out, 32, 18, Math.PI + 0.1, 0, Math.PI / 2);
  assert.deepEqual(centre(out, 32, 18), [255, 0, 0]);
});

test('looking up reaches the sky and every pixel is opaque', () => {
  const out = new Uint8ClampedArray(32 * 18 * 4);
  renderView(picture(), out, 32, 18, 0, Math.PI / 2.5, Math.PI / 2);
  assert.deepEqual(centre(out, 32, 18), [0, 255, 0]);
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255);
});
