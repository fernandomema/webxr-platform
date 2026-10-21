import assert from 'node:assert/strict';
import test from 'node:test';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';

import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';

/** The real ctx, as a script sees it: the script reports through ctx.log. */
function run(code, audio) {
	const scene = new Scene(new NullEngine());
	const node = new TransformNode('n', scene);
	const host = { getSlot: () => undefined, getNode: () => node, getChildren: () => [], allSlots: () => [], getGrabbers: () => [], isHost: () => true, requestSpawn() {}, requestDelete() {}, audio };
	return createCodeBlockHandlers('s', node, code, host);
}

test('ctx.audio exposes analyze and playTrack and forwards them to the host audio', async () => {
	const calls = [];
	const audio = { analyze: async (source) => { calls.push(['analyze', source]); return { duration: 1 }; }, playTrack: async (source, options) => { calls.push(['play', source, options]); return { time: () => 0 }; } };
	const runtime = run(`
		ctx.log(JSON.stringify([typeof ctx.audio.analyze, typeof ctx.audio.playTrack, typeof ctx.audio.play]));
		return { async onSpawn() { ctx.log(JSON.stringify(await ctx.audio.analyze({ kind: 'url', url: '/a.mp3' }))); await ctx.audio.playTrack('x', { volume: 0.5 }); } };
	`, audio);
	await new Promise((resolve) => setImmediate(resolve));
	const messages = runtime.getDebugLog().map((entry) => entry.message);
	assert.deepEqual(messages, ['["function","function","function"]', '{"duration":1}']);
	assert.deepEqual(calls, [['analyze', { kind: 'url', url: '/a.mp3' }], ['play', 'x', { volume: 0.5 }]]);
	assert.deepEqual(runtime.getDebugLog().filter((entry) => entry.level === 'error'), []);
});

test('without an audio host, the calls reject with a clear message instead of crashing the script', async () => {
	const runtime = run(`return { async onSpawn() { await ctx.audio.analyze('x'); } };`, undefined);
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(runtime.getDebugLog()[0].message, /Audio is not available/);
});

/** A fake audio host whose tracks record when they are stopped; `resolve` lets a test finish a track that was still loading. */
function trackingAudio({ deferred = false } = {}) {
	const tracks = [];
	const waiting = [];
	return {
		tracks,
		release: () => waiting.splice(0).forEach((resolve) => resolve()),
		analyze: async () => ({ duration: 1 }),
		playTrack: async () => {
			if (deferred) await new Promise((resolve) => waiting.push(resolve));
			const track = { stopped: 0, time: () => 0, stop() { this.stopped += 1; } };
			tracks.push(track);
			return track;
		}
	};
}

test('removing a code block stops the tracks it started', async () => {
	const audio = trackingAudio();
	const runtime = run(`return { async onSpawn() { await ctx.audio.playTrack('a'); await ctx.audio.playTrack('b'); } };`, audio);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(audio.tracks.length, 2);
	assert.deepEqual(audio.tracks.map((track) => track.stopped), [0, 0], 'they play until the block goes');
	runtime.dispose();
	assert.deepEqual(audio.tracks.map((track) => track.stopped), [1, 1], 'and stop with it');
	runtime.dispose();
	assert.deepEqual(audio.tracks.map((track) => track.stopped), [1, 1], 'disposing twice does no harm');
});

test('a track that finishes loading after its code block was removed is stopped at once', async () => {
	const audio = trackingAudio({ deferred: true });
	const runtime = run(`return { async onSpawn() { await ctx.audio.playTrack('slow'); } };`, audio);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(audio.tracks.length, 0, 'still loading');
	runtime.dispose();
	audio.release();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(audio.tracks.length, 1);
	assert.equal(audio.tracks[0].stopped, 1, 'it never plays on');
});

test('a block that failed to compile can still be disposed', () => {
	const runtime = run(`throw new Error('broken');`, trackingAudio());
	assert.equal(typeof runtime.dispose, 'function');
	assert.doesNotThrow(() => runtime.dispose());
});
