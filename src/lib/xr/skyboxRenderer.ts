import { Color3, CubeTexture, Effect, HemisphericLight, ImageProcessingConfiguration, Mesh, MeshBuilder, ReflectionProbe, RenderTargetTexture, ShaderMaterial, type AbstractMesh, type Scene, type TransformNode } from '@babylonjs/core';
import type { Slot, SkyboxComponent } from '$lib/ecs/types';
import { POLYGON_QUEST_PROBE } from '$lib/assets/builtin';
import type { SourceRef } from '$lib/assets/ref';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary';

export interface SkyboxBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

/** Renamed with the multiview-aware vertex shader, so a page that still holds the old one in its shader store takes the new one. */
const SHADER = 'studioSkyboxMultiview';

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
		varying vec3 vDir;
		void main() {
			vDir = position;
			vec4 worldPos = world * vec4(position, 1.0);
			// Drawing both eyes at once (multiview), each eye has its own view: the same choice Babylon's shaders make.
			#ifdef MULTIVIEW
			if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * worldPos; } else { gl_Position = viewProjectionR * worldPos; }
			#else
			gl_Position = viewProjection * worldPos;
			#endif
		}`;
	Effect.ShadersStore[`${SHADER}FragmentShader`] = `
		precision highp float;
		varying vec3 vDir;
		uniform vec3 topColor;
		uniform vec3 horizonColor;
		uniform vec3 bottomColor;
		uniform float stars;
		void main() {
			vec3 d = normalize(vDir);
			float h = d.y;
			vec3 col = h > 0.0
				? mix(horizonColor, topColor, pow(h, 0.55))
				: mix(horizonColor, bottomColor, pow(-h, 0.45));
			// Procedural stars: one candidate per cell of a 3D grid over the view direction.
			vec3 p = d * 140.0;
			vec3 cell = floor(p);
			float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
			float twinkle = 0.6 + 0.4 * fract(r * 91.7);
			float s = step(1.0 - 0.006 * stars, r) * smoothstep(0.32, 0.0, length(fract(p) - 0.5)) * smoothstep(-0.02, 0.25, h);
			col += vec3(s * twinkle);
			gl_FragColor = vec4(col, 1.0);
		}`;
}

/**
 * Renders a `skybox` component as a huge inside-out sphere that follows the
 * camera (`infiniteDistance`), shaded with a top/horizon/bottom gradient and
 * optional procedural stars. Purely visual: it is never picked, grabbed or
 * lit, and costs one draw call.
 */
export function setupSkybox(scene: Scene, node: TransformNode, initial: SkyboxComponent, assets?: BlobAssetLibrary): SkyboxBinding {
	registerShader();
	const ambient = scene.lights.find((light): light is HemisphericLight => light instanceof HemisphericLight);
	const previousAmbientIntensity = ambient?.intensity;
	const previousEnvironment = scene.environmentTexture;
	const imageProcessing = scene.imageProcessingConfiguration;
	const previousToneMapping = imageProcessing.toneMappingEnabled;
	const previousToneMappingType = imageProcessing.toneMappingType;
	if (initial.toneMapping === 'aces') {
		imageProcessing.toneMappingEnabled = true;
		imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
	}
	const keys = ['reflectionPx', 'reflectionPy', 'reflectionPz', 'reflectionNx', 'reflectionNy', 'reflectionNz'] as const;
	const legacy = initial.reflectionPreset === 'polygon-quest' ? POLYGON_QUEST_PROBE : null;
	const sources: (SourceRef | undefined)[] = keys.map((key) => initial[key] ?? (legacy ? { kind: 'asset', assetId: legacy[key.slice(-2).toLowerCase() as keyof typeof legacy] } : undefined));
	const leases: BlobLease[] = [];
	let disposed = false;
	let probe: CubeTexture | ReflectionProbe | null = null;
	let stopMeshWatch: (() => void) | null = null;
	let stopPoseWatch: (() => void) | null = null;
	// Keep every face present: Array.some skips holes in a sparse array, which
	// would let the first resolved asset start a cubemap with undefined URLs.
	const urls = new Array<string>(6).fill('');
	const useImages = sources.every((source) => source?.kind === 'asset' || (source?.kind === 'url' && source.url));
	function installImageProbe(): void {
		if (disposed || probe || urls.some((url) => !url)) return;
		const texture = CubeTexture.CreateFromImages(urls, scene);
		texture.level = 0.8;
		probe = texture;
		scene.environmentTexture = texture;
	}
	if (useImages) {
		sources.forEach((source, index) => {
			if (source?.kind === 'url') urls[index] = source.url;
			else if (source?.kind === 'asset' && assets) {
				const lease = assets.acquire(source.assetId, () => {
					if (lease.state === 'ready' && lease.url) { urls[index] = lease.url; installImageProbe(); }
				});
				leases.push(lease);
			}
		});
		installImageProbe();
	} else if (initial.reflectionCapture) {
		const capture = new ReflectionProbe('skybox-reflection-capture', 128, scene);
		capture.position = node.getAbsolutePosition().clone();
		// Drawn once, and again a moment after the scene changes (and once more, when its textures have had time to arrive), not
		// every few frames: a capture redrawn while a headset draws both eyes at once (multiview) makes the view flash.
		capture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
		let recapture: ReturnType<typeof setTimeout> | null = null;
		let settle: ReturnType<typeof setTimeout> | null = null;
		const scheduleCapture = () => {
			if (recapture) clearTimeout(recapture);
			if (settle) clearTimeout(settle);
			recapture = setTimeout(() => { if (!disposed) capture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE; }, 1500);
			settle = setTimeout(() => { if (!disposed) capture.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE; }, 6000);
		};
		// Instances too: most of a world's shapes are instances of a few hidden meshes, and the room is what there is to reflect.
		const included = (mesh: AbstractMesh) => mesh.name !== 'studio-ground' && mesh.isVisible && (mesh instanceof Mesh || mesh.getClassName() === 'InstancedMesh');
		capture.renderList = scene.meshes.filter(included);
		const meshObserver = scene.onNewMeshAddedObservable.add((mesh) => {
			if (included(mesh)) capture.renderList?.push(mesh);
			scheduleCapture();
		});
		const removedObserver = scene.onMeshRemovedObservable.add((mesh) => {
			const list = capture.renderList;
			const index = list ? list.indexOf(mesh) : -1;
			if (list && index >= 0) list.splice(index, 1);
		});
		const poseObserver = scene.onBeforeRenderObservable.add(() => capture.position.copyFrom(node.getAbsolutePosition()));
		scheduleCapture();
		stopMeshWatch = () => {
			scene.onNewMeshAddedObservable.remove(meshObserver);
			scene.onMeshRemovedObservable.remove(removedObserver);
			if (recapture) clearTimeout(recapture);
			if (settle) clearTimeout(settle);
		};
		stopPoseWatch = () => scene.onBeforeRenderObservable.remove(poseObserver);
		capture.cubeTexture.level = 0.8;
		probe = capture;
		scene.environmentTexture = capture.cubeTexture;
	}
	const material = new ShaderMaterial(`skybox-mat`, scene, SHADER, {
		attributes: ['position'],
		// `viewProjection` (not a baked worldViewProjection) is what lets Babylon hand each eye its own matrix under multiview.
		uniforms: ['world', 'viewProjection', 'topColor', 'horizonColor', 'bottomColor', 'stars']
	});
	material.backFaceCulling = false;
	material.disableDepthWrite = true;

	const mesh: Mesh = MeshBuilder.CreateSphere('skybox', { diameter: 900, segments: 24 }, scene);
	mesh.material = material;
	mesh.infiniteDistance = true;
	mesh.isPickable = false;
	mesh.applyFog = false;
	mesh.alwaysSelectAsActiveMesh = true;

	function apply(component: SkyboxComponent): void {
		material.setColor3('topColor', Color3.FromHexString(component.topColor || '#0b1030'));
		material.setColor3('horizonColor', Color3.FromHexString(component.horizonColor || '#7c3aed'));
		material.setColor3('bottomColor', Color3.FromHexString(component.bottomColor || '#0f172a'));
		material.setFloat('stars', Math.max(0, Math.min(1, component.stars ?? 0)));
		if (ambient) ambient.intensity = Math.max(0, component.ambientIntensity ?? 1);
	}
	apply(initial);

	return {
		dispose() {
			mesh.dispose();
			material.dispose();
			if (ambient && previousAmbientIntensity !== undefined) ambient.intensity = previousAmbientIntensity;
			disposed = true;
			for (const lease of leases) lease.release();
			stopMeshWatch?.();
			stopPoseWatch?.();
			if (probe) { scene.environmentTexture = previousEnvironment; probe.dispose(); }
			imageProcessing.toneMappingEnabled = previousToneMapping;
			imageProcessing.toneMappingType = previousToneMappingType;
		},
		sync(slot) {
			const component = slot.components.find((candidate): candidate is SkyboxComponent => candidate.type === 'skybox');
			if (component) apply(component);
			if (probe instanceof ReflectionProbe) probe.position = node.getAbsolutePosition().clone();
		}
	};
}
