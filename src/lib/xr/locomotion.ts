import { WebXRFeatureName, type AbstractMesh, type WebXRDefaultExperience, type WebXRMotionControllerTeleportation } from '@babylonjs/core';
import { xrSettings } from './settings';

export interface LocomotionController {
	applySettings(): void;
}

/**
 * Movement mode just toggles Babylon's teleportation feature on/off — smooth
 * locomotion is handled entirely by our own movementController.ts (see its
 * comment for why: Babylon's built-in smooth-movement feature moves along
 * the full camera orientation, including pitch, which feels like flying).
 * Rotation for both modes lives in rotationController.ts, independent of
 * movement mode.
 */
export function setupLocomotion(xr: WebXRDefaultExperience, floorMeshes: AbstractMesh[]): LocomotionController {
	const featuresManager = xr.baseExperience.featuresManager;

	function applySettings(): void {
		if (xrSettings.movementMode !== 'teleport') {
			featuresManager.disableFeature(WebXRFeatureName.TELEPORTATION);
			return;
		}
		const teleportation = featuresManager.enableFeature(WebXRFeatureName.TELEPORTATION, 'latest', {
			floorMeshes,
			xrInput: xr.input
		}) as WebXRMotionControllerTeleportation;
		teleportation.setSelectionFeature(xr.pointerSelection);
		teleportation.rotationEnabled = false;
		xr.teleportation = teleportation;
	}

	applySettings();
	return { applySettings };
}
