import assert from 'node:assert/strict';
import test from 'node:test';

import { batchMaterialUpdates, batchMeshDisposal, MIN_STORE_FRAME_RATE, selectTargetFrameRate, XR_FRAMEBUFFER_SCALE } from '../src/lib/xr/performance.ts';
import { readFileSync } from 'node:fs';
import { MeshBuilder, NullEngine, Scene, StandardMaterial } from '@babylonjs/core';

test('material batches invalidate once and restore nested and failed updates', () => {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const material = new StandardMaterial('mutable', scene);
	let updates = 0;
	const mark = material.markAsDirty.bind(material);
	material.markAsDirty = (flag) => { updates++; mark(flag); };
	try {
		assert.throws(() => batchMaterialUpdates(scene, () => {
			scene.markAllMaterialsAsDirty(1);
			batchMaterialUpdates(scene, () => scene.markAllMaterialsAsDirty(2));
			assert.equal(updates, 0);
			throw new Error('Interrupted construction');
		}), /Interrupted construction/);
		assert.equal(scene.blockMaterialDirtyMechanism, false);
		assert.equal(updates, 1, 'remaining materials are refreshed after a failed batch');
		scene.blockMaterialDirtyMechanism = true;
		assert.equal(batchMaterialUpdates(scene, () => 42), 42);
		assert.equal(scene.blockMaterialDirtyMechanism, true, 'an enclosing batch remains in control');
		assert.equal(updates, 1);
	} finally {
		scene.blockMaterialDirtyMechanism = false;
		scene.dispose(); engine.dispose();
	}
});

test('mesh batches clear render lists once and restore flags after nested failures', () => {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const meshes = Array.from({ length: 8 }, (_, i) => MeshBuilder.CreateBox(`box-${i}`, {}, scene));
	let clears = 0;
	const free = scene.freeActiveMeshes.bind(scene);
	scene.freeActiveMeshes = () => { if (!scene.blockfreeActiveMeshesAndRenderingGroups) clears++; free(); };
	try {
		assert.throws(() => batchMeshDisposal(scene, () => {
			for (const mesh of meshes) batchMeshDisposal(scene, () => mesh.dispose());
			throw new Error('Interrupted teardown');
		}), /Interrupted teardown/);
		assert.equal(clears, 1);
		assert.equal(scene.meshes.length, 0);
		assert.equal(scene.blockfreeActiveMeshesAndRenderingGroups, false);
		scene.blockfreeActiveMeshesAndRenderingGroups = true;
		batchMeshDisposal(scene, () => {});
		assert.equal(scene.blockfreeActiveMeshesAndRenderingGroups, true);
	} finally {
		scene.blockfreeActiveMeshesAndRenderingGroups = false;
		scene.dispose(); engine.dispose();
	}
});

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
