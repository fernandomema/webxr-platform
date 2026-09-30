import {
	AbstractMesh,
	Color3,
	Effect,
	Matrix,
	MirrorTexture,
	Plane,
	ShaderMaterial,
	Vector3,
	type Camera,
	type Scene
} from '@babylonjs/core';
import { mirrorRenderHooks } from './mirrorHooks';

/** A mirror only reflects what is within this distance of it (the sky and the floor, being large, always are). */
const MIRROR_REACH = 8;
/** Further than this from the mirror, the viewer cannot make out a reflection: it shows none, and costs nothing. */
const MIRROR_VIEW = 9;
/** How often the list of what the mirror reflects is brought up to date (at once when meshes come or go). */
const MIRROR_LIST_MS = 500;
/** The mirror's own colour: what it shows with no reflection, and the tint over the reflection. */
const SILVER = new Color3(0.82, 0.88, 0.94);

const SHADER = 'mirrorSurface';

/**
 * The mirror's surface: it shows, for the eye being drawn, the reflection drawn for that eye, looked up where the point
 * of the surface fell in that reflection. With multiview (both eyes in one draw) the eye comes from `gl_ViewID_OVR`;
 * otherwise the eye being drawn is set before each eye renders (`eye`).
 */
function registerShader(): void {
	if (Effect.ShadersStore[`${SHADER}VertexShader`]) return;
	Effect.ShadersStore[`${SHADER}VertexShader`] = `
		precision highp float;
		attribute vec3 position;
		uniform mat4 world;
		uniform mat4 viewProjection;
		#ifdef MULTIVIEW
		uniform mat4 viewProjectionR;
		#endif
		uniform float eye;
		varying vec3 vWorld;
		varying float vEye;
		void main() {
			vec4 worldPos = world * vec4(position, 1.0);
			vWorld = worldPos.xyz;
			#ifdef MULTIVIEW
			vEye = float(gl_ViewID_OVR);
			if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * worldPos; } else { gl_Position = viewProjectionR * worldPos; }
			#else
			vEye = eye;
			gl_Position = viewProjection * worldPos;
			#endif
		}`;
	Effect.ShadersStore[`${SHADER}FragmentShader`] = `
		precision highp float;
		varying vec3 vWorld;
		varying float vEye;
		uniform sampler2D reflectionL;
		uniform sampler2D reflectionR;
		uniform mat4 mirrorL;
		uniform mat4 mirrorR;
		uniform float reflecting;
		uniform vec3 tint;
		void main() {
			bool right = vEye > 0.5;
			vec4 clip = (right ? mirrorR : mirrorL) * vec4(vWorld, 1.0);
			vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
			vec3 reflection = right ? texture2D(reflectionR, uv).rgb : texture2D(reflectionL, uv).rgb;
			gl_FragColor = vec4(mix(tint, reflection * tint * 1.08, reflecting), 1.0);
		}`;
}

/** The cameras an image is drawn for this frame: each eye of a headset, or the one camera on a screen. */
function eyesOf(camera: Camera): Camera[] {
	return camera.rigCameras.length ? camera.rigCameras.slice(0, 2) : [camera];
}

/**
 * A mirror: a reflection of the scene drawn onto the mesh. Each eye gets its own reflection (one drawn for the other eye
 * looks out of place), drawn before the frame itself starts: drawn in the middle of a headset's frame, it spoils that
 * frame when both eyes are drawn at once (multiview). It stays cheap otherwise: it only reflects what is near it, and
 * while the viewer is too far away or looking elsewhere, it draws nothing and shows its plain silver.
 */
export function setupMirrorSurface(scene: Scene, mesh: AbstractMesh, resolution = 512): () => void {
	registerShader();
	const size = Math.min(resolution, 1024);
	// One reflection per eye. They are drawn here, by hand, and nowhere else: no material asks Babylon to draw them.
	const reflections = [0, 1].map((i) => {
		const texture = new MirrorTexture(`${mesh.name}-reflection-${i}`, size, scene, true);
		texture.onBeforeRenderObservable.add(() => mirrorRenderHooks.before.notifyObservers());
		texture.onAfterRenderObservable.add(() => mirrorRenderHooks.after.notifyObservers());
		return texture;
	});
	/** Where each eye's reflection put the world: a point's place in the reflection image. */
	const mirrorMatrices = [Matrix.Identity(), Matrix.Identity()];

	const material = new ShaderMaterial(`${mesh.name}-mirror-material`, scene, SHADER, {
		attributes: ['position'],
		// `viewProjection` (not a baked worldViewProjection) is what lets Babylon hand each eye its own under multiview.
		uniforms: ['world', 'viewProjection', 'eye', 'mirrorL', 'mirrorR', 'reflecting', 'tint'],
		samplers: ['reflectionL', 'reflectionR']
	});
	material.backFaceCulling = false;
	material.setTexture('reflectionL', reflections[0]);
	material.setTexture('reflectionR', reflections[1]);
	material.setColor3('tint', SILVER);
	material.setFloat('reflecting', 0);
	material.setFloat('eye', 0);
	mesh.material = material;
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'mirror' };

	let position = Vector3.Zero();
	let listedAt = -Infinity;
	/** Which reflection the right eye's lookup uses: its own in a headset, the one camera's on a screen. */
	let rightUses = reflections[1];
	const relist = () => {
		listedAt = -Infinity;
	};
	const added = scene.onNewMeshAddedObservable.add(relist);
	const removed = scene.onMeshRemovedObservable.add(relist);

	const reflects = (candidate: AbstractMesh) => {
		if (candidate === mesh || !candidate.isEnabled() || !candidate.isVisible || candidate.metadata?.specialSurface === 'mirror') return false;
		const sphere = candidate.getBoundingInfo().boundingSphere;
		return Vector3.Distance(sphere.centerWorld, position) - sphere.radiusWorld < MIRROR_REACH;
	};

	const drawReflections = () => {
		mesh.computeWorldMatrix(true);
		const world = mesh.getWorldMatrix();
		position = Vector3.TransformCoordinates(Vector3.Zero(), world);
		const normal = Vector3.TransformNormal(Vector3.Forward(), world).normalize();
		const plane = Plane.FromPositionAndNormal(position, normal);
		const now = performance.now();
		if (now - listedAt > MIRROR_LIST_MS) {
			listedAt = now;
			const list = scene.meshes.filter(reflects);
			for (const texture of reflections) texture.renderList = list;
		}

		const camera = scene.activeCamera;
		const eyes = camera ? eyesOf(camera) : [];
		const visible = !!camera && mesh.isEnabled() && Vector3.Distance(camera.globalPosition, position) < MIRROR_VIEW && eyes.some((eye) => eye.isInFrustum(mesh));
		material.setFloat('reflecting', visible ? 1 : 0);
		if (!visible) return;
		eyes.forEach((eye, i) => {
			const texture = reflections[i];
			texture.mirrorPlane = plane;
			texture.activeCamera = eye;
			// As Babylon does before each render target it draws: a fresh pass, so the second eye is not skipped as done.
			scene.incrementRenderId();
			texture.render();
			// What the reflection was drawn with: the eye's view, mirrored in the plane, then its projection.
			const mirror = new Matrix();
			Matrix.ReflectionToRef(plane, mirror);
			mirror.multiply(eye.getViewMatrix()).multiplyToRef(eye.getProjectionMatrix(), mirrorMatrices[i]);
		});
		// On a screen there is one camera: both lookups use its reflection.
		if (eyes.length === 1) mirrorMatrices[1].copyFrom(mirrorMatrices[0]);
		material.setMatrix('mirrorL', mirrorMatrices[0]);
		material.setMatrix('mirrorR', mirrorMatrices[1]);
		const wanted = eyes.length === 1 ? reflections[0] : reflections[1];
		if (wanted !== rightUses) {
			rightUses = wanted;
			material.setTexture('reflectionR', wanted);
		}
	};

	// Drawing each eye on its own (no multiview), the surface is told which eye is being drawn.
	const perEye = scene.onBeforeCameraRenderObservable.add((camera) => {
		const parent = camera.rigParent;
		material.setFloat('eye', parent && parent.rigCameras[1] === camera ? 1 : 0);
	});
	const observer = scene.onBeforeRenderObservable.add(drawReflections);

	return () => {
		scene.onBeforeRenderObservable.remove(observer);
		scene.onBeforeCameraRenderObservable.remove(perEye);
		scene.onNewMeshAddedObservable.remove(added);
		scene.onMeshRemovedObservable.remove(removed);
		for (const texture of reflections) texture.dispose();
		material.dispose();
	};
}
