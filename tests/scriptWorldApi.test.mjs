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

/** The real ctx on a fake host that records what the script asks for. */
function setup({ host = true, slots = {}, equipped = {}, grabbed = [] } = {}) {
	const scene = new Scene(new NullEngine());
	const nodes = new Map();
	const node = (id) => { if (!nodes.has(id)) nodes.set(id, new TransformNode(id, scene)); return nodes.get(id); };
	const spawns = [];
	const commits = [];
	const fake = {
		getSlot: (id) => slots[id], getNode: (id) => (id in slots || id === 'self' ? node(id) : undefined), getChildren: () => [], allSlots: () => [],
		getGrabbers: (id) => (grabbed.includes(id) ? ['right'] : []), isHost: () => host,
		getEquipHolder: (id) => equipped[id] ?? null,
		requestSpawn: (slot, options) => spawns.push({ slot, options }), requestDelete() {},
		commitTransform: (id, broadcast) => commits.push([id, broadcast])
	};
	let ctx;
	createCodeBlockHandlers('self', node('self'), 'globalThis.__ctx = ctx; return {};', fake);
	ctx = globalThis.__ctx; delete globalThis.__ctx;
	return { ctx, spawns, commits, node };
}

test('spawn passes the ephemeral option on to the host, and sounds and sparks are ephemeral by themselves', () => {
	const { ctx, spawns } = setup();
	ctx.world.spawn({ name: 'Tracer', components: [{ type: 'expires', expiresAt: Date.now() + 100 }] }, { ephemeral: true });
	ctx.world.spawn({ name: 'Crate' });
	ctx.particles.burst({ color: '#fff' });
	ctx.audio.play({ frequency: 300 });
	assert.deepEqual(spawns.map((s) => s.options?.ephemeral ?? false), [true, false, true, true]);
	assert.deepEqual(spawns.map((s) => s.slot.name), ['Tracer', 'Crate', 'Particle Burst', 'Impact Sound']);
});

const part = { id: 'bar', parentId: 'gun', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] };

test('a part of an equipped tool can be moved and scaled inside it, but the tool itself cannot', () => {
	const slots = { gun: { id: 'gun', parentId: null, components: [] }, bar: part };
	const hand = { playerId: 'p', hand: 'right' };
	const { ctx, commits, node } = setup({ slots, equipped: { gun: hand, bar: hand } });
	assert.equal(ctx.world.setLocalPose('bar', { position: [0.1, 0.2, 0.3], scale: [0.5, 1, 1] }, false), true);
	assert.deepEqual(node('bar').position.asArray().map((v) => Math.round(v * 1e6) / 1e6), [0.1, 0.2, 0.3]);
	assert.deepEqual(node('bar').scaling.asArray(), [0.5, 1, 1]);
	assert.deepEqual(commits, [['bar', false]], 'it is recorded, and not broadcast as a whole snapshot');
	assert.equal(ctx.world.setLocalPose('gun', { position: [1, 1, 1] }), false, 'the hand owns the tool');
	assert.equal(commits.length, 1);
});

test('setLocalPose refuses what a hand is holding, bad numbers, unknown slots and a guest', () => {
	const slots = { bar: part };
	const held = setup({ slots, grabbed: ['bar'] });
	assert.equal(held.ctx.world.setLocalPose('bar', { position: [0, 0, 0] }), false);
	const free = setup({ slots });
	for (const bad of [{ position: [NaN, 0, 0] }, { position: [0, 0] }, { rotation: [0, 0, 0] }, { scale: [0, 1, 1] }, { scale: [1, -1, 1] }, { scale: [1, 1, Infinity] }]) {
		assert.equal(free.ctx.world.setLocalPose('bar', bad), false, JSON.stringify(bad));
	}
	assert.equal(free.ctx.world.setLocalPose('missing', { position: [0, 0, 0] }), false);
	assert.deepEqual(free.commits, []);
	assert.equal(free.ctx.world.setLocalPose('bar', { rotation: [0, 0, 0, 2] }), true, 'a rotation is normalised');
	assert.equal(setup({ host: false, slots }).ctx.world.setLocalPose('bar', { position: [0, 0, 0] }), false, 'only the host moves things');
});
