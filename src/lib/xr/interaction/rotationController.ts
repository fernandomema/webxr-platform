import { Quaternion, WebXRControllerComponent, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import { xrSettings } from '../settings';
import { isHandLocked } from './handLock';

const AXIS_DEADZONE = 0.15;
const SNAP_THRESHOLD = 0.7;
const SMOOTH_SPEED = 1.2; // rad/s

/**
 * Turning is independent of movement mode (see plan), driven by the RIGHT
 * hand's thumbstick (left hand drives movement, see locomotion.ts).
 *
 * Rotates the camera's quaternion directly — mirroring exactly how
 * Babylon's own teleportation snap-turn does it internally — instead of
 * writing to `camera.cameraRotation`. In this Babylon version that
 * accumulator runs through a momentum/glide system meant for mouse-look
 * input, which made a snap turn drift smoothly over several frames and
 * compounded on itself for smooth turning instead of applying cleanly.
 */
export function setupRotationController(scene: Scene, xr: WebXRDefaultExperience): void {
	let axisX = 0;
	let snapLatched = false; // one snap per stick push; requires returning to center to re-arm

	xr.input.onControllerAddedObservable.add((controller) => {
		if (controller.inputSource.handedness === 'left') return; // right hand drives turning

		controller.onMotionControllerInitObservable.add((motionController) => {
			const stick =
				motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE) ??
				motionController.getComponentOfType(WebXRControllerComponent.TOUCHPAD_TYPE);
			stick?.onAxisValueChangedObservable.add((axes) => {
				axisX = axes.x;
			});
		});

		controller.onDisposeObservable.add(() => {
			axisX = 0;
		});
	});

	function rotateCameraBy(radians: number): void {
		const camera = xr.baseExperience.camera;
		Quaternion.FromEulerAngles(0, radians, 0).multiplyToRef(camera.rotationQuaternion, camera.rotationQuaternion);
	}

	scene.onBeforeRenderObservable.add(() => {
		if (isHandLocked('right')) return;
		const sign = scene.useRightHandedSystem ? -1 : 1;

		if (Math.abs(axisX) < AXIS_DEADZONE) {
			snapLatched = false;
			return;
		}

		if (xrSettings.rotationMode === 'smooth') {
			const dt = scene.getEngine().getDeltaTime() / 1000;
			rotateCameraBy(axisX * SMOOTH_SPEED * dt * sign);
			return;
		}

		if (snapLatched || Math.abs(axisX) < SNAP_THRESHOLD) return;
		snapLatched = true;

		const angle = xrSettings.rotationMode === 'snap-90' ? Math.PI / 2 : Math.PI / 4;
		rotateCameraBy(angle * (axisX > 0 ? 1 : -1) * sign);
	});
}
