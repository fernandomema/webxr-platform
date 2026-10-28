import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { SceneColliders } from '../packages/engine/src/xr/sceneColliders.ts';
import { createScriptPhysics } from '../packages/engine/src/xr/scriptPhysics.ts';
import { buildCodeBlockCtx } from './helpers/codeBlockRuntimeModule.mjs';

function stage() {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const entries = [];
	const source = { allSlots: () => entries, onChanged: () => () => {} };
	const add = (id, position, scaling, parentId = null) => {
		const mesh = MeshBuilder.CreateBox(id, { size: 1 }, scene);
		mesh.position = new Vector3(...position); mesh.scaling = new Vector3(...scaling);
		entries.push({ slot: createSlot({ id, name: id, parentId, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#fff' }, { type: 'collider', shape: 'box' }] }), node: mesh });
	};
	add('wall', [10, 0, 0], [1, 10, 10]);
	add('crate', [5, 0, 0], [1, 1, 1]);
	add('crate-lid', [5, 1, 0], [1, 1, 1], 'crate');
	const colliders = new SceneColliders(source);
	const parents = new Map(entries.map((e) => [e.slot.id, e.slot.parentId]));
	return { physics: createScriptPhysics(colliders, (id) => parents.get(id) ?? null), dispose: () => { scene.dispose(); engine.dispose(); } };
}

test('a script asks what a ray, a sphere and a point meet, and gets plain answers', () => {
	const s = stage();
	const ray = s.physics.raycast([0, 0, 0], [1, 0, 0], 100);
	assert.equal(ray.slotId, 'crate');
	assert.ok(Math.abs(ray.t - 4.5) < 1e-3);
	assert.deepEqual(ray.normal.map((n) => Math.round(n) + 0), [-1, 0, 0]);
	const swept = s.physics.sphereCast([0, 0, 0], 0.5, [1, 0, 0], 100);
	assert.ok(Math.abs(swept.t - 4) < 1e-2, `${swept.t}`);
	assert.equal(s.physics.overlapSphere([9.2, 0, 0], 0.5)[0].slotId, 'wall');
	assert.equal(s.physics.closest([6.5, 0, 0], 10).slotId, 'crate');
	s.dispose();
});

test('ignoring a slot ignores what is under it, and bad arguments are answered as nothing found', () => {
	const s = stage();
	assert.equal(s.physics.raycast([0, 0, 0], [1, 0, 0], 100, { ignore: ['crate'] }).slotId, 'wall');
	assert.equal(s.physics.raycast([0, 1, 0], [1, 0, 0], 100, { ignore: ['crate'] }).slotId, 'wall', 'the lid is under the crate');
	assert.equal(s.physics.raycast([0, 0, 0], [0, 0, 0], 100), null);
	assert.equal(s.physics.raycast([0, 0, NaN], [1, 0, 0], 100), null);
	assert.equal(s.physics.raycast('no', [1, 0, 0], 100), null);
	assert.deepEqual(s.physics.overlapSphere([0, 0, 0], -1), []);
	assert.equal(s.physics.sphereCast([0, 0, 0], 0.5, [1, 0, 0], -5), null);
	s.dispose();
});

test('ctx.physics, ctx.haptics and world.setPlayerVelocity reach the engine, host only, with checked arguments', () => {
	const calls = [];
	const physics = { raycast: (...a) => { calls.push(['raycast', ...a]); return { slotId: 'x', t: 1, point: [0, 0, 0], normal: [0, 1, 0] }; }, sphereCast: () => null, overlapSphere: () => [], closest: () => null };
	const host = {
		isHost: () => true, physics,
		setPlayerVelocity: (id, v, add) => { calls.push(['velocity', id, v, add]); return true; },
		hapticPulse: (id, hand, intensity, ms) => { calls.push(['haptic', id, hand, intensity, ms]); return true; }
	};
	const engine = new NullEngine(); const scene = new Scene(engine);
	const ctx = buildCodeBlockCtx('s', new TransformNode('n', scene), host, () => {}, { disposed: false, tracks: new Set() });
	assert.equal(ctx.physics.raycast([0, 0, 0], [1, 0, 0], 5, { ignore: ['a'] }).slotId, 'x');
	assert.equal(ctx.world.setPlayerVelocity('p', [1, 2, 3], { add: true }), true);
	assert.equal(ctx.world.setPlayerVelocity('p', [1, 2, 'x']), false, 'a velocity that is not three numbers');
	assert.equal(ctx.world.setPlayerVelocity('p', [1, 2, 9999]), false, 'and not an absurd one');
	assert.equal(ctx.haptics.pulse({ id: 'p' }, { hand: 'left', intensity: 5, durationMs: 99999 }), true);
	assert.deepEqual(calls.filter((c) => c[0] !== 'raycast'), [['velocity', 'p', [1, 2, 3], true], ['haptic', 'p', 'left', 1, 2000]]);
	const guest = buildCodeBlockCtx('s', new TransformNode('m', scene), { ...host, isHost: () => false }, () => {}, { disposed: false, tracks: new Set() });
	assert.equal(guest.world.setPlayerVelocity('p', [1, 2, 3]), false);
	assert.equal(guest.haptics.pulse('p'), false);
});
