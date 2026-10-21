import { Effect, Mesh, MeshBuilder, ShaderMaterial, Texture, Vector4, type AbstractMesh, type Camera, type Scene } from '@babylonjs/core';

/**
 * A window onto a stereo 360° picture (left eye above right eye), drawn as a plane laid over a part of a flat panel. Each eye of a
 * headset sees its own half, so the view has depth; on a flat screen it shows the left half. It is a plane of its own, not part of
 * the panel's GUI texture, because the GUI texture is one picture for both eyes.
 */

export interface StereoPanoramaPlane {
	/** Which part of the equirectangular picture shows: the middle column, the top row, and how much of each side is in view (0 to 1 of the picture). */
	setWindow(centerU: number, top: number, spanU: number, spanV: number): void;
	/** Where it lies on the panel, in the panel's texture pixels. */
	place(rect: { left: number; top: number; width: number; height: number }, texture: { width: number; height: number }): void;
	setVisible(visible: boolean): void;
	dispose(): void;
}

/** Named for the multiview-aware vertex shader, like the skybox's. */
const SHADER = 'worldStereoPanoramaMultiview';
/** In front of the panel, so the plane is drawn over it, in the panel's own (unscaled) units. */
const LIFT = -0.004;

function registerShader(): void {
	if (Effect.ShadersStore[`${SHADER}VertexShader`]) return;
	Effect.ShadersStore[`${SHADER}VertexShader`] = `
		precision highp float;
		attribute vec3 position;
		attribute vec2 uv;
		uniform mat4 world;
		uniform mat4 viewProjection;
		#ifdef MULTIVIEW
		uniform mat4 viewProjectionR;
		#endif
		uniform float eye;
		varying vec2 vUV;
		varying float vEye;
		void main() {
			vUV = uv;
			vec4 worldPos = world * vec4(position, 1.0);
			// Both eyes in one draw (multiview): each has its own view, and is told apart here; otherwise the eye is set per camera.
			#ifdef MULTIVIEW
			if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * worldPos; vEye = 0.0; } else { gl_Position = viewProjectionR * worldPos; vEye = 1.0; }
			#else
			gl_Position = viewProjection * worldPos;
			vEye = eye;
			#endif
		}`;
	Effect.ShadersStore[`${SHADER}FragmentShader`] = `
		precision highp float;
		varying vec2 vUV;
		varying float vEye;
		uniform sampler2D panorama;
		// x: middle column, y: top row, z: width in view, w: height in view (all as fractions of one eye's picture)
		uniform vec4 window;
		void main() {
			float u = window.x + (vUV.x - 0.5) * window.z;
			float row = window.y + (1.0 - vUV.y) * window.w;
			// Left eye on the top half of the picture, right eye on the bottom half. The texture is flipped, so up is 1.
			float v = 1.0 - (row * 0.5 + step(0.5, vEye) * 0.5);
			gl_FragColor = vec4(texture2D(panorama, vec2(u, v)).rgb, 1.0);
		}`;
}

/** 0 for the left eye (or a screen), 1 for the right eye, of the camera being drawn. */
function eyeOf(camera: Camera | null | undefined): number {
	const rig = camera?.rigParent;
	return rig && camera ? Math.min(1, Math.max(0, rig.rigCameras.indexOf(camera))) : 0;
}

export function createStereoPanoramaPlane(scene: Scene, panel: AbstractMesh, url: string, onReady: () => void): StereoPanoramaPlane {
	registerShader();
	const material = new ShaderMaterial('world-stereo-panorama', scene, SHADER, {
		attributes: ['position', 'uv'],
		// `viewProjection` (not a baked worldViewProjection) is what lets Babylon hand each eye its own matrix under multiview.
		uniforms: ['world', 'viewProjection', 'eye', 'window'],
		samplers: ['panorama']
	});
	material.backFaceCulling = false;
	// Sides of the picture wrap round; the poles do not.
	const texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, () => { mesh.setEnabled(true); onReady(); });
	texture.wrapU = Texture.WRAP_ADDRESSMODE;
	texture.wrapV = Texture.CLAMP_ADDRESSMODE;
	material.setTexture('panorama', texture);
	material.setVector4('window', new Vector4(0.5, 0.3, 0.3, 0.38));
	material.setFloat('eye', 0);

	const mesh: Mesh = MeshBuilder.CreatePlane('world-stereo-panorama', { size: 1 }, scene);
	mesh.parent = panel;
	mesh.material = material;
	// The laser goes through it to the panel, whose GUI is what reads the pointer.
	mesh.isPickable = false;
	mesh.position.z = LIFT;
	mesh.setEnabled(false);
	mesh.onBeforeRenderObservable.add(() => material.setFloat('eye', eyeOf(scene.activeCamera)));

	return {
		setWindow(centerU, top, spanU, spanV) {
			material.setVector4('window', new Vector4(centerU, top, spanU, spanV));
		},
		place(rect, size) {
			// The panel is a plane of one unit across its texture, centred, with y up; the texture's rows run down.
			mesh.position.x = (rect.left + rect.width / 2) / size.width - 0.5;
			mesh.position.y = 0.5 - (rect.top + rect.height / 2) / size.height;
			mesh.scaling.set(rect.width / size.width, rect.height / size.height, 1);
		},
		setVisible(next) {
			mesh.setEnabled(next && texture.isReady());
		},
		dispose() {
			mesh.dispose();
			material.dispose();
			texture.dispose();
		}
	};
}
