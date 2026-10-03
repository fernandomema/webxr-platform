import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { MeshBuilder, NullEngine, Observable, PointerEventTypes, PointerInfoPre, Ray, Scene, TransformNode, UniversalCamera, Vector3, WebXRControllerComponent } from '@babylonjs/core';

const libUrl = new URL('../src/lib/', import.meta.url);
const source = await readFile(new URL('xr/interaction/pointerController.ts', libUrl), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core')))
	.replaceAll("'./handLock'", JSON.stringify(new URL('xr/interaction/handLock.ts', libUrl).href))
	.replaceAll("'./pushPull'", JSON.stringify(new URL('xr/interaction/pushPull.ts', libUrl).href))
	.replaceAll("'$lib/ecs/types'", JSON.stringify(new URL('ecs/types.ts', libUrl).href));
const { setupPointerAndGrabControllers } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture() {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	scene.activeCamera = new UniversalCamera('camera', new Vector3(0, 0, -4), scene);
	const controllers = [];
	const hovered = new Map();
	const xr = {
		input: { controllers, onControllerAddedObservable: new Observable() },
		pointerSelection: {
			getXRControllerByPointerId(id) { return controllers.find((c) => c.pointerId === id) ?? null; },
			getMeshUnderPointer(id) { return hovered.get(id) ?? null; }
		}
	};
	const graph = {
		getSlotIdForNode(node) { return node?.metadata?.slotId ?? null; },
		resolveGrabTarget(id) { return id; },
		slotIds() { return ['left-target', 'right-target']; }
	};
	const grabs = { getHeldSlot() { return null; }, getGrabbersForSlot() { return []; } };
	const equipment = { onChanged: new Observable() };
	const state = setupPointerAndGrabControllers(scene, xr, graph, grabs, equipment, () => 'local');
	for (const [index, side] of ['left', 'right'].entries()) {
		const controller = {
			uniqueId: side, pointerId: index + 1, inputSource: { handedness: side },
			pointer: new TransformNode(`${side}-pointer`, scene),
			onMotionControllerInitObservable: new Observable(), onDisposeObservable: new Observable(),
			getWorldPointerRayToRef(ray) { ray.origin.set(index * 2, 0, -4); ray.direction.copyFrom(Vector3.Forward()); }
		};
		controllers.push(controller);
		xr.input.onControllerAddedObservable.notifyObservers(controller);
		const trigger = { onButtonStateChangedObservable: new Observable() };
		controller.trigger = trigger;
		controller.onMotionControllerInitObservable.notifyObservers({
			getComponentOfType(type) { return type === WebXRControllerComponent.TRIGGER_TYPE ? trigger : null; }
		});
		const mesh = MeshBuilder.CreateBox(`${side}-target`, {}, scene);
		mesh.position.x = index * 2;
		mesh.metadata = { slotId: `${side}-target` };
		hovered.set(side, mesh);
	}
	let picks = 0;
	const pick = scene.pickWithRay.bind(scene);
	scene.pickWithRay = (...args) => { picks++; return pick(...args); };
	function frame(shared = true, near = false) {
		for (const mesh of scene.meshes) mesh.computeWorldMatrix(true);
		if (shared) for (const controller of controllers) {
			const ray = new Ray(Vector3.Zero(), Vector3.Forward(), 5);
			controller.getWorldPointerRayToRef(ray);
			const hit = scene.pickWithRay(ray);
			const info = new PointerInfoPre(PointerEventTypes.POINTERMOVE, { pointerId: controller.pointerId }, 0, 0);
			info.originalPickingInfo = hit;
			if (near) info.nearInteractionPickingInfo = hit;
			scene.onPrePointerObservable.notifyObservers(info, PointerEventTypes.POINTERMOVE);
		}
		scene.onBeforeRenderObservable.notifyObservers(scene);
		scene.onAfterRenderObservable.notifyObservers(scene);
	}
	return { scene, controllers, state, frame, picks: () => picks, dispose() { scene.dispose(); engine.dispose(); } };
}

test('both lasers reuse Babylon picks and inspector targeting adds no raycast', () => {
	const f = fixture();
	try {
		// A consuming GUI observer must still leave the original pick available to our beam.
		f.scene.onPrePointerObservable.add((info) => { info.skipOnPointerObservable = true; });
		for (let i = 0; i < 10; i++) {
			f.frame();
			assert.equal(f.state.getLaserTarget('left'), 'left-target');
			assert.equal(f.state.getLaserTarget('right'), 'right-target');
			assert.equal(f.picks(), (i + 1) * 2, 'one existing pick per hand, with no duplicate scene scans');
		}
		for (const controller of f.controllers) {
			const beam = f.scene.meshes.find((m) => m.name === 'laser' && m.parent === controller.pointer);
			assert.equal(beam.scaling.y, 3.5);
			assert.equal(beam.isEnabled(), true);
		}
	} finally { f.dispose(); }
});

test('missing/near-only pointer events use fresh fallback picks and exclude hidden panels', () => {
	const f = fixture();
	try {
		f.frame();
		f.scene.getMeshByName('left-target').setEnabled(false);
		f.scene.getMeshByName('right-target').isVisible = false;
		f.frame(false);
		assert.equal(f.picks(), 4, 'the previous frame\'s results must not survive detachment');
		assert.equal(f.state.getLaserTarget('left'), null);
		assert.equal(f.state.getLaserTarget('right'), null);
		f.frame(true, true);
		assert.equal(f.picks(), 8, 'near-interaction picks cannot be used as laser impacts');
	} finally { f.dispose(); }
});

test('a shared hit beyond the laser range does not extend the beam or inspector target', () => {
	const f = fixture();
	try {
		// The built-in pointer can have a longer range; inject its valid distant hit.
		const info = new PointerInfoPre(PointerEventTypes.POINTERMOVE, { pointerId: 1 }, 0, 0);
		info.originalPickingInfo = { hit: true, distance: 8, pickedMesh: f.scene.getMeshByName('left-target'), pickedPoint: new Vector3(0, 0, 4) };
		f.scene.onPrePointerObservable.notifyObservers(info, PointerEventTypes.POINTERMOVE);
		f.scene.onBeforeRenderObservable.notifyObservers(f.scene);
		assert.equal(f.state.getLaserTarget('left'), null);
		const beam = f.scene.meshes.find((m) => m.name === 'laser' && m.parent === f.controllers[0].pointer);
		assert.equal(beam.scaling.y, 5);
		assert.equal(f.picks(), 1, 'only the hand without a shared pick needs a fallback');
	} finally { f.dispose(); }
});
