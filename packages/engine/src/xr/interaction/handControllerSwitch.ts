import { WebXRFeatureName, type WebXRDefaultExperience, type WebXRHand, type WebXRHandTracking } from '@babylonjs/core';

function useHandBoneTexture(hand: WebXRHand): void {
	const mesh = hand.handMesh;
	const skeleton = mesh?.skeleton;
	if (!mesh || !skeleton) return;
	const changed = !skeleton.useTextureToStoreBoneMatrices;
	// Babylon's default hands force vertex uniforms, which can exhaust Quest's practical multiview budget.
	// Skeleton handles hardware support itself and retains the uniform fallback on devices without bone textures.
	if (changed) skeleton.useTextureToStoreBoneMatrices = true;
	const needsTexture = skeleton.isUsingTextureForMatrices && !skeleton.getTransformMatrixTexture(mesh);
	if (needsTexture) {
		// Babylon 9 allocates the texture only when allocating its matrix buffer. If uniforms were already prepared,
		// changing the flag alone leaves that buffer in place and never creates the texture. Reset the allocation cache.
		const cache = skeleton as unknown as { _transformMatrices: Float32Array | null; _synchronizedWithMesh: unknown };
		if (skeleton.needInitialSkinMatrix) {
			mesh._bonesTransformMatrices = null;
			cache._synchronizedWithMesh = null;
		} else cache._transformMatrices = null;
		// Also marks the skeleton dirty when the storage option was already enabled but the texture was missing.
		skeleton.useTextureToStoreBoneMatrices = true;
		skeleton.prepare(true);
	}
	// Cached hands may already have a compiled or frozen material; rebuild its bone-storage shader defines.
	if (changed || needsTexture) mesh.material?.markDirty(true);
}

/**
 * Best-effort mitigation for a stale controller/hand mesh sticking around
 * when the player switches between hand tracking and physical controllers.
 * Babylon's own hand-tracking feature disposes the old representation when
 * it gets an add/remove event for that controller id, but some runtimes
 * mutate the existing XRInputSource in place on a pure modality switch
 * instead of firing those — so this explicitly hides the OTHER
 * representation too, whenever either one initializes for the same
 * controller id.
 * Also prepares cached and asynchronously loaded hand meshes for texture-based skinning in multiview.
 */
export function setupHandControllerSwitch(xr: WebXRDefaultExperience): void {
	const handTracking = xr.baseExperience.featuresManager.getEnabledFeature(
		WebXRFeatureName.HAND_TRACKING
	) as WebXRHandTracking | undefined;
	if (!handTracking) return;

	const prepareHand = (hand: WebXRHand) => {
		useHandBoneTexture(hand);
		// A hand can be attached before its default GLB has finished loading, and re-entry can replace that mesh.
		hand.onHandMeshSetObservable.add(useHandBoneTexture);
		hand.xrController.motionController?.rootMesh?.setEnabled(false);
	};
	handTracking.onHandAddedObservable.add(prepareHand);
	for (const side of ['left', 'right'] as const) {
		const hand = handTracking.getHandByHandedness(side);
		if (hand) prepareHand(hand);
	}

	xr.input.onControllerAddedObservable.add((controller) => {
		controller.onMotionControllerInitObservable.add(() => {
			handTracking.getHandByControllerId(controller.uniqueId)?.handMesh?.setEnabled(false);
		});
	});
}
