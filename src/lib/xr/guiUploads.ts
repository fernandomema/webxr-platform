import type { Camera, Scene } from '@babylonjs/core';

/**
 * Uploads every GUI texture that changed (a sign, a panel, the readout) before the frame starts drawing.
 *
 * Babylon repaints a GUI texture when a camera is about to render, which in a headset is after the headset's own
 * framebuffer is bound. With multiview on a tiled GPU (Quest), uploading a texture, and making its mipmaps, in the middle
 * of that pass makes the driver end the pass early, and the frame being drawn is lost: the view flashes grey. Done here,
 * before anything is bound, there is nothing left to upload when the cameras render.
 *
 * Register it after everything else that may change a GUI during a frame (observers run in the order they were added).
 */
export function uploadGuiBeforeDrawing(scene: Scene): () => void {
	const observer = scene.onBeforeRenderObservable.add(() => {
		const camera = scene.activeCamera;
		if (!camera) return;
		for (const texture of scene.textures) {
			if (texture.getClassName() !== 'AdvancedDynamicTexture') continue;
			// Repaints and uploads only when something changed; Babylon's own check at render time then finds it clean.
			(texture as unknown as { _checkUpdate(camera: Camera): void })._checkUpdate(camera);
		}
	});
	return () => scene.onBeforeRenderObservable.remove(observer);
}
