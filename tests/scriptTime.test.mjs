import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';

function run(code) {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const host = { isHost: () => true, getSlot: () => undefined, getChildren: () => [], allSlots: () => [] };
	const runtime = createCodeBlockHandlers('t', new TransformNode('t', scene), code, host);
	return { runtime, dispose: () => { scene.dispose(); engine.dispose(); } };
}

test('a script gets the scaled time, and steps of a fixed length however long the frames are', () => {
	const s = run(`
		const log = [];
		let simulated = 0, steps = 0;
		return {
			tick(dt) {
				log.push(dt);
				for (let i = ctx.time.fixed(0.02); i > 0; i--) { simulated += 0.02; steps++; }
				if (log.length === 4) ctx.time.setScale(0.5);
				globalThis.report = { log, simulated, steps, now: ctx.time.now(), raw: ctx.time.unscaledDelta(), scale: ctx.time.getScale() };
			},
			getRadialItems() { return [{ label: JSON.stringify(globalThis.report), isEnabled: () => true, onSelect() {} }]; }
		};`);
	const read = () => JSON.parse(s.runtime.getRadialItems()[0].label);
	// 60 fps: three frames make one step of 0.02 s (a little less than 0.05 s).
	for (let i = 0; i < 4; i++) s.runtime.tick(1 / 60);
	let r = read();
	assert.equal(r.steps, 3, 'four frames of 1/60 are 0.0667 s: three steps of 0.02');
	assert.equal(r.scale, 0.5);
	s.runtime.tick(1 / 30);
	r = read();
	assert.ok(Math.abs(r.log.at(-1) - 1 / 60) < 1e-9, 'a frame at half speed is half as long');
	assert.ok(Math.abs(r.raw - 1 / 30) < 1e-9, 'and the real time is still there');
	s.runtime.tick(1);
	r = read();
	assert.ok(r.steps <= 3 + 2 + 8, 'a very long frame is capped, not caught up');
	s.dispose();
});
