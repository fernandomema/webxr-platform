import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeCamera, MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';

import { EXPERIMENTS, experimentVisible, governStep, isExperimentOn, visibleExperiments } from '../packages/engine/src/xr/experiments.ts';
import { uploadGuiBeforeDrawing } from '../packages/engine/src/xr/guiUploads.ts';
import { xrSettings } from '../packages/engine/src/xr/settings.ts';

const byId = (id) => {
	const experiment = EXPERIMENTS.find((candidate) => candidate.id === id);
	assert.ok(experiment, `experiment ${id} exists`);
	return experiment;
};

test('every experiment shows in dev; a player build only sees the ones listed for production', () => {
	assert.ok(visibleExperiments(true).length === EXPERIMENTS.length);
	// None ships to players today; the capability is what is tested here.
	assert.deepEqual(visibleExperiments(false), []);
	assert.equal(experimentVisible({ id: 'a', label: 'a', description: 'a', apply() {} }, false), false, 'dev-only by default');
	assert.equal(experimentVisible({ id: 'a', label: 'a', description: 'a', environments: ['dev', 'prod'], apply() {} }, false), true, 'listed for prod');
	assert.equal(experimentVisible({ id: 'a', label: 'a', description: 'a', apply() {} }, true), true, 'dev sees everything');
});

test('isExperimentOn follows both the setting and the build environment', () => {
	xrSettings.experiments = {};
	xrSettings.experiments.adaptiveQuality = true;
	try {
		assert.equal(isExperimentOn('adaptiveQuality', true), true);
		assert.equal(isExperimentOn('adaptiveQuality', false), false, 'with nothing listed for prod, nothing runs in a player build');
		assert.equal(isExperimentOn('adaptiveQuality', true), true);
		xrSettings.experiments.adaptiveQuality = false;
		assert.equal(isExperimentOn('adaptiveQuality', false), false);
	} finally {
		xrSettings.experiments = {};
	}
});

test('the governor trades foveation first, then script rate, and gives it back up to the player settings', () => {
	const floor = { foveation: 'medium', scriptRate: 1 };
	let current = { ...floor };
	current = governStep(current, floor, 0.7);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 1 });
	current = governStep(current, floor, 0.7);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 2 });
	current = governStep(current, floor, 0.7);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 3 });
	current = governStep(current, floor, 0.7);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 4 });
	assert.equal(governStep(current, floor, 0.7), null, 'nothing left to trade');
	current = governStep(current, floor, 1.0);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 3 }, 'recovery starts with script rate');
	current = governStep(current, floor, 1.0);
	current = governStep(current, floor, 1.0);
	assert.deepEqual(current, { foveation: 'high', scriptRate: 1 });
	current = governStep(current, floor, 1.0);
	assert.deepEqual(current, { foveation: 'medium', scriptRate: 1 }, 'foveation returns to the player setting');
	assert.equal(governStep(current, floor, 1.0), null, 'recovery never goes past the player setting');
	assert.equal(governStep(current, floor, 0.9), null, 'a comfortable ratio changes nothing');
});

function sceneWithCamera() {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	scene.activeCamera = new FreeCamera('camera', new Vector3(0, 0, 0), scene);
	return { engine, scene };
}

test('freezeStatics freezes still meshes, leaves moving ones alone and unfreezes on off', () => {
	const { engine, scene } = sceneWithCamera();
	try {
		const still = MeshBuilder.CreateBox('still', {}, scene);
		const moving = MeshBuilder.CreateBox('moving', {}, scene);
		const context = { scene, scripts: { farScripts: null } };
		byId('freezeStatics').apply(true, context);
		for (let frame = 0; frame < 130; frame++) {
			moving.position.x += 0.1;
			scene.render();
		}
		assert.equal(still.isWorldMatrixFrozen, true, 'a mesh that never moved is frozen');
		assert.equal(moving.isWorldMatrixFrozen, false, 'a mesh that keeps moving is not');
		// The bowling-ball case: something frozen gets grabbed or script-moved after freezing. The next frame must let it
		// go (in-place writes count) and its world matrix must follow again.
		const before = still.getAbsolutePosition().x;
		still.position.x += 1;
		scene.render();
		assert.equal(still.isWorldMatrixFrozen, false, 'a write to a frozen mesh unfreezes it the next frame');
		assert.ok(still.getAbsolutePosition().x > before, 'its world matrix follows the move again');
		byId('freezeStatics').apply(false, context);
		assert.equal(still.isWorldMatrixFrozen, false, 'turning the experiment off unfreezes');
	} finally {
		scene.dispose();
		engine.dispose();
	}
});

test('autoLod hides far meshes, shows them again up close and restores everything on off', () => {
	const { engine, scene } = sceneWithCamera();
	try {
		const near = MeshBuilder.CreateBox('near', {}, scene);
		const far = MeshBuilder.CreateBox('far', {}, scene);
		far.position.set(0, 0, 40);
		const context = { scene, scripts: { farScripts: null } };
		byId('autoLod').apply(true, context);
		for (let frame = 0; frame < 20; frame++) scene.render();
		assert.equal(near.isVisible, true, 'a near mesh stays visible');
		assert.equal(far.isVisible, false, 'a far mesh stops drawing');
		far.position.set(0, 0, 5);
		for (let frame = 0; frame < 20; frame++) scene.render();
		assert.equal(far.isVisible, true, 'coming closer draws it again');
		far.position.set(0, 0, 40);
		for (let frame = 0; frame < 20; frame++) scene.render();
		byId('autoLod').apply(false, context);
		assert.equal(far.isVisible, true, 'turning the experiment off restores visibility');
	} finally {
		scene.dispose();
		engine.dispose();
	}
});

test('dashGuiHalfRate uploads the dash GUI every second frame', () => {
	const { engine, scene } = sceneWithCamera();
	try {
		const uploads = { dash: 0, sign: 0 };
		const fakeTexture = (name, counter) => ({
			name,
			getClassName: () => 'AdvancedDynamicTexture',
			_checkUpdate: () => uploads[counter]++,
			dispose: () => {}
		});
		const dashTexture = fakeTexture('AdvancedDynamicTexture for dash-panel [x]', 'dash');
		scene.textures.push(dashTexture);
		scene.textures.push(fakeTexture('AdvancedDynamicTexture for shop-sign [y]', 'sign'));
		const stop = uploadGuiBeforeDrawing(scene);
		// The test process is not a dev build, so list the experiment for production for the duration of the test.
		const dashExperiment = EXPERIMENTS.find((candidate) => candidate.id === 'dashGuiHalfRate');
		assert.ok(dashExperiment);
		const environments = dashExperiment.environments;
		dashExperiment.environments = ['dev', 'prod'];
		xrSettings.experiments = { dashGuiHalfRate: true };
		try {
			scene.render();
			scene.render();
			scene.render();
			scene.render();
			assert.equal(uploads.dash, 2, 'the dash repaints half as often');
			assert.equal(uploads.sign, 4, 'other GUI is untouched');
			// Frame 4 was even: Babylon's own camera-time check repaints. After one more render the frame is odd, and that
			// check must be refused — repainting there, after the XR framebuffer is bound, is the grey flash.
			dashTexture._checkUpdate(scene.activeCamera);
			assert.equal(uploads.dash, 3, 'Babylon\'s check repaints on a run frame');
			scene.render();
			dashTexture._checkUpdate(scene.activeCamera);
			assert.equal(uploads.dash, 3, 'Babylon\'s own check is refused on a skipped frame');
		} finally {
			stop();
			xrSettings.experiments = {};
			dashExperiment.environments = environments;
		}
	} finally {
		scene.dispose();
		engine.dispose();
	}
});
