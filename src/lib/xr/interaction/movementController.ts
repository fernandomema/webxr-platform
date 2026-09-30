import { Vector3, WebXRControllerComponent, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import { xrSettings } from '../settings';
import { isHandLocked, isStickYClaimed } from './handLock';
import type { PlayerBody } from './playerBody';

const DEADZONE = 0.15;
const WALK_SPEED = 1.9; // m/s
const RUN_SPEED = 3.4; // m/s
/** How far both sticks must be pushed forward to run. */
const RUN_PUSH = 0.6;

/**
 * Smooth locomotion, driven by the LEFT hand's thumbstick (right hand turns,
 * see rotationController.ts). Pushing the right stick forward as well, while
 * walking forward, breaks into a run: turning only reads that stick sideways. Babylon's own `WebXRControllerMovement`
 * feature moves along the full camera/controller orientation (pitch
 * included), so looking up/down made the player fly — this only ever moves
 * on the horizontal plane, FPS-style, regardless of where you're looking.
 */
export function setupMovementController(scene: Scene, xr: WebXRDefaultExperience, body?: PlayerBody): void {
	let moveX = 0;
	let moveY = 0;
	let runY = 0;

	xr.input.onControllerAddedObservable.add((controller) => {
		if (controller.inputSource.handedness === 'right') {
			controller.onMotionControllerInitObservable.add((motionController) => {
				motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE)?.onAxisValueChangedObservable.add((axes) => {
					runY = axes.y;
				});
			});
			controller.onDisposeObservable.add(() => {
				runY = 0;
			});
			return; // left hand drives movement
		}

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
		// A stick pushing a laser-held object away or closer is not also walking or running.
		const walkY = isStickYClaimed('left') ? 0 : moveY;
		if (Math.abs(moveX) < DEADZONE && Math.abs(walkY) < DEADZONE) return;

		const camera = xr.baseExperience.camera;
		const rawForward = camera.getForwardRay().direction;
		const forward = new Vector3(rawForward.x, 0, rawForward.z);
		if (forward.lengthSquared() < 0.0001) return;
		forward.normalize();
		const right = Vector3.Cross(Vector3.Up(), forward).normalize();

		const dt = scene.getEngine().getDeltaTime() / 1000;
		// gamepad Y: pushing the stick forward/up reports a negative value
		const running = walkY < -RUN_PUSH && runY < -RUN_PUSH && !isHandLocked('right') && !isStickYClaimed('right');
		const speed = running ? RUN_SPEED : WALK_SPEED;
		const delta = forward.scale(-walkY * speed * dt).add(right.scale(moveX * speed * dt));
		camera.position.addInPlace(body ? body.constrainMove(delta) : delta);
	});
}
