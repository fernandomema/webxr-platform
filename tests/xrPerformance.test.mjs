import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_STORE_FRAME_RATE, selectTargetFrameRate, XR_FRAMEBUFFER_SCALE } from '../src/lib/xr/performance.ts';
import { readFileSync } from 'node:fs';

test('automatic refresh rate chooses the lowest stable Quest rate', () => {
	assert.equal(selectTargetFrameRate([120, 90, 72, 80], null), 72);
	assert.equal(selectTargetFrameRate([60, 90], null), 90);
});

test('an available user-selected refresh rate wins', () => {
	assert.equal(selectTargetFrameRate([72, 80, 90], 90), 90);
	assert.equal(selectTargetFrameRate([72, 80, 90], 120), 72);
});

test('automatic refresh rate never selects 60 FPS or invalid values', () => {
	assert.equal(selectTargetFrameRate([0, Number.NaN, 60], null), null);
	assert.equal(MIN_STORE_FRAME_RATE, 72);
	assert.ok(XR_FRAMEBUFFER_SCALE > 0 && XR_FRAMEBUFFER_SCALE < 1);
});

test('the render loop indexes dynamic slots and skips pointer-move picking', () => {
	const sceneGraph = readFileSync(new URL('../src/lib/xr/sceneGraph.ts', import.meta.url), 'utf8');
	const engine = readFileSync(new URL('../src/lib/xr/engine.ts', import.meta.url), 'utf8');
	assert.match(sceneGraph, /slotsWith\('codeBlock'\)/);
	assert.match(sceneGraph, /slotsWith\('velocity'\)/);
	assert.match(sceneGraph, /slotsWith\('expires'\)/);
	assert.match(engine, /scene\.skipPointerMovePicking = true/);
});
