import test from 'node:test';
import assert from 'node:assert/strict';
import { frustumLines, cameraBodyLines, insetPixels, FRAME_DISTANCE } from '../src/lib/studio/previewCameraGeometry.ts';

test('the frustum has four edges from the camera, a frame, and an up marker', () => {
	const lines = frustumLines(90);
	assert.equal(lines.length, 6);
	for (const edge of lines.slice(0, 4)) assert.deepEqual(edge[0], [0, 0, 0]);
	const frame = lines[4];
	assert.equal(frame.length, 5);
	assert.deepEqual(frame[0], frame[4], 'the frame closes');
	assert.ok(lines.flat().every((p) => p.every(Number.isFinite)));
});

test('the frame is as wide as the field of view says, square, and above it sits the up marker', () => {
	const half = (fov) => frustumLines(fov)[4][1][0];
	assert.ok(Math.abs(half(90) - FRAME_DISTANCE) < 1e-9, '90° sees as far to the side as it is deep');
	assert.ok(half(30) < half(60) && half(60) < half(100));
	const [left, right, bottom, top] = [frustumLines(60)[4][0][0], frustumLines(60)[4][1][0], frustumLines(60)[4][2][1], frustumLines(60)[4][0][1]];
	assert.ok(Math.abs(right - left - (top - bottom)) < 1e-9, 'square, like the pictures');
	const marker = frustumLines(60)[5];
	assert.ok(marker[1][1] > top, 'the marker peaks above the frame');
	assert.ok(frustumLines(1000)[4][1][0] < 100 && frustumLines(-5)[4][1][0] > 0, 'silly values are kept sane');
});

test('the camera body is a box of twelve edges worth of lines', () => {
	const body = cameraBodyLines();
	assert.equal(body.length, 6);
	assert.ok(body.flat().every((p) => p[2] <= 0.05 + 1e-9), 'it sits at and behind the camera position');
});

test('the corner view is a sensible square that shrinks with the viewport', () => {
	assert.equal(insetPixels(1600, 900), 260);
	assert.equal(insetPixels(500, 400), 150);
	assert.equal(insetPixels(200, 200), 120);
});
