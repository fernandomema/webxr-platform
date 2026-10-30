import type { Camera, Scene } from '@babylonjs/core';
import { profiled } from './profiler.ts';
import { isExperimentOn } from './experiments.ts';

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
	let frame = 0;
	/**
	 * While the dash half-rate experiment is on, the dash texture's own `_checkUpdate` is wrapped: on the frames this pass
	 * skips, every repaint is refused, from this pass and from Babylon's camera-time check alike. Skipping only this pass
	 * is not enough — Babylon's check fires after the headset's framebuffer is bound, and repainting there (an upload in
	 * the middle of the multiview pass) is what flashes the view grey.
	 */
	const originals = new WeakMap<object, (camera: Camera) => void>();
	const restore = (texture: object) => {
		const original = originals.get(texture);
		if (!original) return;
		(texture as unknown as { _checkUpdate(camera: Camera): void })._checkUpdate = original;
		originals.delete(texture);
	};
	const observer = scene.onBeforeRenderObservable.add(() => {
		const camera = scene.activeCamera;
		if (!camera) return;
		frame++;
		const halfRate = isExperimentOn('dashGuiHalfRate');
		for (const texture of scene.textures) {
			if (texture.getClassName() !== 'AdvancedDynamicTexture') continue;
			const dash = texture.name.includes('dash');
			if (!dash || !halfRate) {
				restore(texture);
				profiled(`gui:${texture.name}`, () => (texture as unknown as { _checkUpdate(camera: Camera): void })._checkUpdate(camera));
				continue;
			}
			const target = texture as unknown as { _checkUpdate(camera: Camera): void };
			if (!originals.has(texture)) {
				const original = target._checkUpdate.bind(texture);
				originals.set(texture, original);
				target._checkUpdate = (cam: Camera) => {
					if ((frame & 1) === 1) return;
					original(cam);
				};
			}
			if ((frame & 1) === 1) continue;
			profiled(`gui:${texture.name}`, () => target._checkUpdate(camera));
		}
	});
	return () => {
		scene.onBeforeRenderObservable.remove(observer);
		for (const texture of scene.textures) restore(texture);
	};
}
