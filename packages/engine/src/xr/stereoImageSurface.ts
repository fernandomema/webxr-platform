import { Effect, Matrix, Mesh, ShaderMaterial, Texture, Vector2, Vector3, type AbstractMesh, type Camera, type Scene } from '@babylonjs/core';
import { normalizeSourceRef, type SourceRef } from '../assets/ref.ts';
import type { StereoImageComponent, StereoImageLayout } from '../ecs/types.ts';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary.ts';

/**
 * A picture on a surface, in 2D or in 3D. The surface is the slot's own mesh (a plane, usually): each eye of a headset sees its own
 * half of a stereo picture, so it has depth; on a flat screen the left half shows. It is the picture's own material, not a
 * texture of a GUI, because a GUI texture is one picture for both eyes. The picture is shown whole, so give the surface the shape
 * of one eye's view (its aspect is the picture's, not the file's); nothing is stretched here.
 */

export interface StereoImageBinding {
	sync(component: StereoImageComponent): void;
	dispose(): void;
}

const SHADER = 'stereoImageSurfaceMultiview';
/**
 * How deep a spatial picture is when its component does not say, as a fraction of its width. The view only leans as far as the viewer
 * is to the side of a small card (a card 14 cm across seen from 40 cm leans by about a quarter of its depth), so it has to be generous.
 */
const RELIEF = 0.35;
/** Layout as the number the shader reads. */
const LAYOUT_CODE: Record<StereoImageLayout, number> = { mono: 0, sbs: 1, tb: 2, depth: 3 };
const LAYOUTS = Object.keys(LAYOUT_CODE) as StereoImageLayout[];

/** The layout a stored value means; anything unknown is a flat picture. */
export const stereoLayoutOf = (value: unknown): StereoImageLayout => (LAYOUTS as unknown[]).includes(value) ? (value as StereoImageLayout) : 'mono';

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
		// Where each eye is, in the surface's own space (for a spatial picture, which is looked into from where the eye is).
		uniform vec3 eyeObjectL;
		uniform vec3 eyeObjectR;
		// The surface's size in metres, across and up.
		uniform vec2 planeSize;
		varying vec2 vUV;
		varying float vEye;
		varying vec3 vToEye;
		void main() {
			vUV = uv;
			vec4 worldPos = world * vec4(position, 1.0);
			// Both eyes in one draw (multiview): each has its own view, and is told apart here; otherwise the eye is set per camera.
			#ifdef MULTIVIEW
			if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * worldPos; vEye = 0.0; vToEye = eyeObjectL - vec3(position.xy * planeSize, 0.0); } else { gl_Position = viewProjectionR * worldPos; vEye = 1.0; vToEye = eyeObjectR - vec3(position.xy * planeSize, 0.0); }
			#else
			gl_Position = viewProjection * worldPos;
			vEye = eye;
			vToEye = (eye < 0.5 ? eyeObjectL : eyeObjectR) - vec3(position.xy * planeSize, 0.0);
			#endif
		}`;
	Effect.ShadersStore[`${SHADER}FragmentShader`] = `
		precision highp float;
		varying vec2 vUV;
		varying float vEye;
		varying vec3 vToEye;
		uniform sampler2D picture;
		// 0: one picture, 1: left eye then right eye side by side, 2: left eye above right eye, 3: picture then its depth map side by side
		uniform float stereoLayout;
		uniform float swapEyes;
		uniform float relief;
		uniform float inset;
		uniform vec2 planeSize;
		// The depth map is the right half; white is near. Half a texel in from the edge, so the picture does not bleed into it.
		float nearness(vec2 uv) { return texture2D(picture, vec2(0.5 + clamp(uv.x, 0.002, 0.998) * 0.5, clamp(uv.y, 0.002, 0.998))).r; }
		void main() {
			float eyeIndex = abs(vEye - swapEyes);
			vec2 uv = vUV;
			if (stereoLayout > 2.5) {
				// A spatial picture: walk from the surface into the picture along the line of sight until it meets the depth map, so what
				// is near shifts more than what is far as the eye moves, and what lay behind the near parts comes into view.
				// The surface lies on x and y of its own space and is looked at from its -z side. The line of sight is in metres (the surface
				// may be stretched, a card a few millimetres thick has a z a thousand times shorter than its x), and the depth is a fraction of the width.
				vec3 toEye = normalize(vToEye);
				vec2 slope = toEye.xy / max(-toEye.z, 0.15);
				// The picture is wider than what shows (a margin on every side): what shows is its middle, and a shift in what shows is
				// that much smaller in the picture.
				float shown = 1.0 - 2.0 * inset;
				vec2 stride = -slope * relief * shown * vec2(1.0, planeSize.x / planeSize.y) / 32.0;
				float height = 1.0;
				vec2 at = vec2(inset) + uv * shown;
				for (int i = 0; i < 32; i++) {
					if (nearness(at) >= height) break;
					at += stride;
					height -= 1.0 / 32.0;
				}
				at = clamp(at, 0.002, 0.998);
				gl_FragColor = vec4(texture2D(picture, vec2(at.x * 0.5, at.y)).rgb, 1.0);
				return;
			}
			// The texture is flipped on load, so up is 1.
			if (stereoLayout > 1.5) uv.y = uv.y * 0.5 + (1.0 - eyeIndex) * 0.5;
			else if (stereoLayout > 0.5) uv.x = uv.x * 0.5 + eyeIndex * 0.5;
			gl_FragColor = vec4(texture2D(picture, uv).rgb, 1.0);
		}`;
}

/** 0 for the left eye (or a screen), 1 for the right eye, of the camera being drawn. */
function eyeOf(camera: Camera | null | undefined): number {
	const rig = camera?.rigParent;
	return rig && camera ? Math.min(1, Math.max(0, rig.rigCameras.indexOf(camera))) : 0;
}

export function setupStereoImageSurface(scene: Scene, mesh: AbstractMesh, initial: StereoImageComponent, media?: BlobAssetLibrary): StereoImageBinding {
	registerShader();
	const material = new ShaderMaterial(`${mesh.name}-stereo-image`, scene, SHADER, {
		attributes: ['position', 'uv'],
		// `viewProjection` (not a baked worldViewProjection) is what lets Babylon hand each eye its own matrix under multiview.
		uniforms: ['world', 'viewProjection', 'eye', 'stereoLayout', 'swapEyes', 'relief', 'inset', 'eyeObjectL', 'eyeObjectR', 'planeSize'],
		samplers: ['picture']
	});
	material.backFaceCulling = false;
	material.setFloat('eye', 0);
	material.setFloat('relief', RELIEF);
	material.setFloat('inset', 0);
	material.setVector2('planeSize', new Vector2(1, 1));
	material.setVector3('eyeObjectL', Vector3.Zero());
	material.setVector3('eyeObjectR', Vector3.Zero());
	mesh.material = material;
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'stereo-image' };
	// Drawn only once the picture is there: until then the surface is hidden rather than a flash of nothing.
	const previousVisibility = mesh.visibility;
	mesh.visibility = 0;
	const inverse = new Matrix();
	const scale = new Vector3();
	const eyeObject = [new Vector3(), new Vector3()];
	const before = mesh instanceof Mesh ? mesh.onBeforeRenderObservable.add(() => {
		const active = scene.activeCamera;
		material.setFloat('eye', eyeOf(active));
		// Where each eye is, in the surface's own space: a headset's two eyes (both drawn at once under multiview), or the one camera.
		if (!active) return;
		const world = mesh.getWorldMatrix();
		world.invertToRef(inverse);
		world.decompose(scale);
		scale.set(Math.max(Math.abs(scale.x), 1e-6), Math.max(Math.abs(scale.y), 1e-6), Math.max(Math.abs(scale.z), 1e-6));
		material.setVector2('planeSize', new Vector2(scale.x, scale.y));
		const eyes = active.rigCameras.length >= 2 ? [active.rigCameras[0], active.rigCameras[1]] : [active, active];
		eyes.forEach((eye, index) => Vector3.TransformCoordinatesToRef(eye.globalPosition, inverse, eyeObject[index]).multiplyInPlace(scale));
		material.setVector3('eyeObjectL', eyeObject[0]);
		material.setVector3('eyeObjectR', eyeObject[1]);
	}) : null;

	let texture: Texture | null = null;
	let lease: BlobLease | null = null;
	let shown = '';
	let disposed = false;

	const show = (url: string) => {
		if (disposed || !url || url === shown) return;
		shown = url;
		const old = texture;
		const next = new Texture(url, scene, {
			noMipmap: false,
			invertY: true,
			samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
			onLoad: () => {
				if (disposed || texture !== next) return;
				material.setTexture('picture', next);
				mesh.visibility = previousVisibility;
				old?.dispose();
			},
			onError: () => { if (texture === next) shown = ''; }
		});
		next.wrapU = next.wrapV = Texture.CLAMP_ADDRESSMODE;
		texture = next;
	};

	const setSource = (source: SourceRef) => {
		lease?.release();
		lease = null;
		if (source.kind === 'url') { show(source.url); return; }
		if (!media) return;
		const mine = media.acquire(source.assetId, () => { if (lease === mine && mine.state === 'ready' && mine.url) show(mine.url); });
		lease = mine;
	};

	const apply = (component: StereoImageComponent) => {
		material.setFloat('stereoLayout', LAYOUT_CODE[stereoLayoutOf(component.layout)]);
		material.setFloat('swapEyes', component.swapEyes ? 1 : 0);
		material.setFloat('relief', component.relief ?? RELIEF);
		material.setFloat('inset', component.inset ?? 0);
		setSource(normalizeSourceRef(component.source));
	};
	apply(initial);

	return {
		sync: apply,
		dispose() {
			disposed = true;
			if (before && mesh instanceof Mesh) mesh.onBeforeRenderObservable.remove(before);
			lease?.release();
			texture?.dispose();
			material.dispose();
			mesh.visibility = previousVisibility;
		}
	};
}
