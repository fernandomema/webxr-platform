import { Vector3, WebXRControllerComponent, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import { xrSettings } from '../settings';
import { isHandLocked } from './handLock';
import type { PlayerBody } from './playerBody';

const DEADZONE = 0.15;
const MOVE_SPEED = 1.4; // m/s

/**
 * Smooth locomotion, driven by the LEFT hand's thumbstick (right hand turns,
 * see rotationController.ts). Babylon's own `WebXRControllerMovement`
 * feature moves along the full camera/controller orientation (pitch
 * included), so looking up/down made the player fly — this only ever moves
 * on the horizontal plane, FPS-style, regardless of where you're looking.
 */
export function setupMovementController(scene: Scene, xr: WebXRDefaultExperience, body?: PlayerBody): void {
	let moveX = 0;
	let moveY = 0;

	xr.input.onControllerAddedObservable.add((controller) => {
		if (controller.inputSource.handedness === 'right') return; // left hand drives movement

		controller.onMotionControllerInitObservable.add((motionController) => {
			const stick =
				motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE) ??
				motionController.getComponentOfType(WebXRControllerComponent.TOUCHPAD_TYPE);
			stick?.onAxisValueChangedObservable.add((axes) => {
				moveX = axes.x;
				moveY = axes.y;
			});
		});

		controller.onDisposeObservable.add(() => {
			moveX = 0;
			moveY = 0;
		});
	});

	scene.onBeforeRenderObservable.add(() => {
		if (xrSettings.movementMode !== 'smooth' || isHandLocked('left')) return;
		if (Math.abs(moveX) < DEADZONE && Math.abs(moveY) < DEADZONE) return;

		const camera = xr.baseExperience.camera;
		const rawForward = camera.getForwardRay().direction;
		const forward = new Vector3(rawForward.x, 0, rawForward.z);
		if (forward.lengthSquared() < 0.0001) return;
		forward.normalize();
		const right = Vector3.Cross(Vector3.Up(), forward).normalize();

		const dt = scene.getEngine().getDeltaTime() / 1000;
		// gamepad Y: pushing the stick forward/up reports a negative value
		const delta = forward.scale(-moveY * MOVE_SPEED * dt).add(right.scale(moveX * MOVE_SPEED * dt));
		camera.position.addInPlace(body ? body.constrainMove(delta) : delta);
	});
}
