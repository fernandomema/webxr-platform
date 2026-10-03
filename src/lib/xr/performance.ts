import type { Scene } from '@babylonjs/core';

/** Coalesces material invalidation during synchronous construction/teardown, preserving an enclosing batch. */
export function batchMaterialUpdates<T>(scene: Scene, update: () => T): T {
	const wasBlocked = scene.blockMaterialDirtyMechanism;
	scene.blockMaterialDirtyMechanism = true;
	try {
		return update();
	} finally {
		// Babylon marks all materials dirty once when this flag returns to false.
		scene.blockMaterialDirtyMechanism = wasBlocked;
	}
}

/** Clears render lists once for synchronous bulk disposal, including nested subtree removals. */
export function batchMeshDisposal<T>(scene: Scene, dispose: () => T): T {
	const wasBlocked = scene.blockfreeActiveMeshesAndRenderingGroups;
	// Babylon clears the lists when blocking begins; each mesh can then skip the same scene-wide cleanup.
	scene.blockfreeActiveMeshesAndRenderingGroups = true;
	try {
		return dispose();
	} finally {
		scene.blockfreeActiveMeshesAndRenderingGroups = wasBlocked;
	}
}

/** Conservative Quest defaults: leave GPU headroom instead of chasing the headset's highest refresh rate. */
export const XR_FRAMEBUFFER_SCALE = 0.8;
export const MIN_STORE_FRAME_RATE = 72;

/**
 * Resolve the refresh rate for a session. A user choice wins when the headset offers it; otherwise use the lowest
 * supported rate that remains above Meta's 60 FPS floor. The lower target gives each frame the largest stable budget.
 */
export function selectTargetFrameRate(supported: readonly number[], requested: number | null): number | null {
	const rates = [...supported].filter((rate) => Number.isFinite(rate) && rate > 0).sort((a, b) => a - b);
	if (requested !== null && rates.includes(requested)) return requested;
	return rates.find((rate) => rate >= MIN_STORE_FRAME_RATE) ?? rates.find((rate) => rate > 60) ?? null;
}
