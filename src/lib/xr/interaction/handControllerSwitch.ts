import { WebXRFeatureName, type WebXRDefaultExperience, type WebXRHandTracking } from '@babylonjs/core';

/**
 * Best-effort mitigation for a stale controller/hand mesh sticking around
 * when the player switches between hand tracking and physical controllers.
 * Babylon's own hand-tracking feature disposes the old representation when
 * it gets an add/remove event for that controller id, but some runtimes
 * mutate the existing XRInputSource in place on a pure modality switch
 * instead of firing those — so this explicitly hides the OTHER
 * representation too, whenever either one initializes for the same
 * controller id.
 */
export function setupHandControllerSwitch(xr: WebXRDefaultExperience): void {
	const handTracking = xr.baseExperience.featuresManager.getEnabledFeature(
		WebXRFeatureName.HAND_TRACKING
	) as WebXRHandTracking | undefined;
	if (!handTracking) return;

	handTracking.onHandAddedObservable.add((hand) => {
		hand.xrController.motionController?.rootMesh?.setEnabled(false);
	});

	xr.input.onControllerAddedObservable.add((controller) => {
		controller.onMotionControllerInitObservable.add(() => {
			handTracking.getHandByControllerId(controller.uniqueId)?.handMesh?.setEnabled(false);
		});
	});
}
