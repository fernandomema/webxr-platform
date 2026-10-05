import { MeshBuilder, Quaternion, SceneInstrumentation, StandardMaterial, Color3, Vector3, type Camera, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, TextBlock } from '@babylonjs/gui';
import { THEME } from './theme';

/**
 * A small readout, low on the left of the view, of what the world costs to draw: frames per second, the time a frame
 * takes, draw calls (both eyes in a headset), meshes drawn and triangles. Turned on from the Settings tab, to see on the
 * headset itself what a world or a change does to its speed.
 */
export interface PerformanceOverlay {
	setVisible(visible: boolean): void;
	dispose(): void;
}

const REFRESH_MS = 500;

export function createPerformanceOverlay(scene: Scene, getCamera: () => Camera): PerformanceOverlay {
	const plane = MeshBuilder.CreatePlane('performance-overlay', { width: 0.24, height: 0.12 }, scene);
	plane.isPickable = false;
	// Over everything, like the radial menu.
	plane.renderingGroupId = 1;
	const material = new StandardMaterial('performance-overlay', scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;
	plane.setEnabled(false);

	const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 256, false);
	texture.background = '#0b1220dd';
	const text = new TextBlock('performance-text', '');
	text.color = THEME.text;
	text.fontSize = 30;
	text.fontFamily = 'monospace';
	text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	text.paddingLeft = '24px';
	texture.addControl(text);

	let instrumentation: SceneInstrumentation | null = null;
	let shownAt = 0;

	const place = () => {
		const camera = getCamera();
		const forward = camera.getForwardRay().direction;
		const up = camera.upVector ?? Vector3.Up();
		const right = Vector3.Cross(up, forward).normalize();
		// Low and to the left, out of the way of what is being looked at.
		plane.position = camera.globalPosition.add(forward.scale(0.65)).add(right.scale(-0.2)).add(up.scale(-0.2));
		// Turned to face the viewer: its readable side towards them, not its back (which reads mirrored).
		plane.rotationQuaternion = Quaternion.FromLookDirectionLH(forward.scale(-1), up);
	};

	const observer = scene.onBeforeRenderObservable.add(() => {
		if (!instrumentation) return;
		place();
		const now = performance.now();
		if (now - shownAt < REFRESH_MS) return;
		shownAt = now;
		const engine = scene.getEngine();
		const frameMs = instrumentation.frameTimeCounter.lastSecAverage;
		text.text = [
			`FPS        ${engine.getFps().toFixed(0)}`,
			`Frame      ${frameMs.toFixed(1)} ms`,
			`Draw calls ${instrumentation.drawCallsCounter.lastSecAverage.toFixed(0)}`,
			`Meshes     ${scene.getActiveMeshes().length}`,
			`Triangles  ${(scene.getActiveIndices() / 3 / 1000).toFixed(1)}k`
		].join('\n');
	});

	return {
		setVisible(visible) {
			if (visible && !instrumentation) {
				instrumentation = new SceneInstrumentation(scene);
				instrumentation.captureFrameTime = true;
				shownAt = 0;
			} else if (!visible && instrumentation) {
				instrumentation.dispose();
				instrumentation = null;
			}
			plane.setEnabled(visible);
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(observer);
			instrumentation?.dispose();
			texture.dispose();
			material.dispose();
			plane.dispose();
		}
	};
}
