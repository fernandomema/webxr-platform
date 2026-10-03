import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';

const coreUrl = import.meta.resolve('@babylonjs/core');
const libUrl = new URL('../src/lib/', import.meta.url);
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
	.replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const { createCodeBlockHandlers } = await import(moduleUrl(compile(await readFile(new URL('xr/codeBlockRuntime.ts', libUrl), 'utf8'))
	.replaceAll("'./scriptNet'", JSON.stringify(new URL('xr/scriptNet.ts', libUrl).href))));

/** The real ctx, as a script sees it: `probe` runs the script body and reports through the host's spawn hook. */
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
		globalThis.__probe = { kinds: [typeof ctx.audio.analyze, typeof ctx.audio.playTrack, typeof ctx.audio.play] };
		return { async onSpawn() { globalThis.__probe.result = await ctx.audio.analyze({ kind: 'url', url: '/a.mp3' }); await ctx.audio.playTrack('x', { volume: 0.5 }); } };
	`, audio);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(globalThis.__probe.kinds, ['function', 'function', 'function']);
	assert.deepEqual(calls, [['analyze', { kind: 'url', url: '/a.mp3' }], ['play', 'x', { volume: 0.5 }]]);
	assert.deepEqual(runtime.getDebugLog(), []);
});

test('without an audio host, the calls reject with a clear message instead of crashing the script', async () => {
	const runtime = run(`return { async onSpawn() { await ctx.audio.analyze('x'); } };`, undefined);
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(runtime.getDebugLog()[0].message, /Audio is not available/);
});
