import {
	ArcRotateCamera,
	Color3,
	Color4,
	DirectionalLight,
	Engine,
	HemisphericLight,
	FreeCamera,
	Ray,
	RenderTargetTexture,
	Scene,
	Vector3,
	type AbstractEngine,
	type AbstractMesh
} from '@babylonjs/core';
import type { Slot, SlotTree } from '$lib/ecs/types';
import type { AssetResolver } from '$lib/assets/resolve';
import { getLocalAssetStore } from '$lib/assets/store';
import { BlobAssetLibrary } from '../blobAssetLibrary';
import { ModelLibrary } from '../modelLibrary';
import { SceneGraph } from '../sceneGraph';
import { isFloorSlot } from '../interaction/playerBody';
import { bustBounds, frameBounds, THUMBNAIL_FOV, type V3 } from './framing';
import { cubeToEquirect, flipRows } from './cubeToEquirect';
import { stripActiveComponents } from './inertTree';

/**
 * Renders previews of inventory items in a scene of their own that lives only for the picture: nothing in it runs (see
 * `stripActiveComponents`), it is never ticked, and everything is disposed when the picture is taken.
 */

export interface RenderOptions {
	/** Draw in a second scene on this engine (in the game, where a second WebGL context would be costly) instead of a hidden one. */
	engine?: AbstractEngine;
	/** Where to look for a model this device does not have. The local store is always tried first, so an item made here needs no network. */
	getResolvers?: () => AssetResolver[];
	/** How long to wait for models to load before drawing what is there. */
	waitMs?: number;
	/** Set `cancelled` to make an unfinished render stop and clean up. */
	signal?: { cancelled: boolean };
}

export const OBJECT_SIZE = 256;
export const PANORAMA_SIZE = { width: 1024, height: 512 };
const CUBE_FACE = 512;
/** Where the panorama is taken from: the origin the headset starts at, at eye height above whatever floor is there. */
export const WORLD_SPAWN = { x: 0, z: 0 };
const EYE_HEIGHT = 1.6;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Stage {
	engine: AbstractEngine;
	scene: Scene;
	sceneGraph: SceneGraph;
	dispose(): void;
}

async function buildStage(tree: SlotTree, options: RenderOptions): Promise<Stage> {
	let canvas: HTMLCanvasElement | null = null;
	const ownEngine = !options.engine;
	const engine: AbstractEngine =
		options.engine ??
		new Engine((canvas = Object.assign(document.createElement('canvas'), { width: OBJECT_SIZE, height: OBJECT_SIZE })), true, { preserveDrawingBuffer: true, audioEngine: false });
	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.09, 0.1, 0.14, 1);
	// Diffuse light only: a shiny highlight on a flat floor would turn it white when it is seen from straight above.
	const sky = new HemisphericLight('thumbnail-sky', new Vector3(0.25, 1, 0.2), scene);
	sky.intensity = 0.95;
	sky.specular = Color3.Black();
	const sun = new DirectionalLight('thumbnail-sun', new Vector3(-0.4, -1, -0.6), scene);
	sun.intensity = 0.55;
	sun.specular = Color3.Black();

	const getResolvers = options.getResolvers ?? (() => []);
	const models = new ModelLibrary(scene, { store: getLocalAssetStore(), getResolvers });
	const mediaAssets = new BlobAssetLibrary({ store: getLocalAssetStore(), getResolvers });
	const sceneGraph = new SceneGraph(scene, { models, mediaAssets });
	sceneGraph.load(stripActiveComponents(JSON.parse(JSON.stringify(tree)) as SlotTree));

	const stage: Stage = {
		engine,
		scene,
		sceneGraph,
		dispose() {
			sceneGraph.dispose();
			models.dispose();
			mediaAssets.dispose();
			scene.dispose();
			if (ownEngine) engine.dispose();
			canvas?.remove();
		}
	};

	// Wait until every model has loaded or given up ("missing" is retried later, which a picture cannot wait for).
	const deadline = performance.now() + (options.waitMs ?? 5000);
	while (performance.now() < deadline && !options.signal?.cancelled) {
		const waiting = sceneGraph.allSlots().some((entry) => entry.model && (entry.assetState === undefined || entry.assetState === 'pending' || entry.assetState === 'loading'));
		if (!waiting) break;
		await sleep(60);
	}
	await scene.whenReadyAsync();
	return stage;
}

/** What is actually drawn: hit proxies, hidden placeholders and the sky are not part of an object's size. */
function visibleBounds(scene: Scene): { min: V3; max: V3 } | null {
	const min: V3 = [Infinity, Infinity, Infinity];
	const max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const mesh of scene.meshes) {
		if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0 || mesh.infiniteDistance || mesh.getTotalVertices() === 0) continue;
		mesh.computeWorldMatrix(true);
		const box = mesh.getBoundingInfo().boundingBox;
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis], box.minimumWorld.asArray()[axis]);
			max[axis] = Math.max(max[axis], box.maximumWorld.asArray()[axis]);
		}
	}
	return Number.isFinite(min[0] + max[0]) ? { min, max } : null;
}

/** Waits (a few frames' worth) until the shaders the picture needs have compiled, so it is not drawn with missing materials. */
async function whenDrawable(scene: Scene, target: RenderTargetTexture, signal?: { cancelled: boolean }): Promise<void> {
	const deadline = performance.now() + 3000;
	while (performance.now() < deadline && !signal?.cancelled) {
		if (target.isReadyForRendering() && scene.meshes.every((mesh) => !mesh.isEnabled() || mesh.isReady(true))) return;
		await sleep(30);
	}
}

/** Draws the scene as seen by `camera` into an offscreen texture and returns its RGBA pixels, top row first. */
async function drawTopDown(scene: Scene, camera: FreeCamera | ArcRotateCamera, size: number, signal?: { cancelled: boolean }): Promise<Uint8Array | null> {
	const target = new RenderTargetTexture('thumbnail-target', { width: size, height: size }, scene, { generateMipMaps: false, generateDepthBuffer: true });
	try {
		target.activeCamera = camera;
		target.renderList = scene.meshes.slice();
		target.clearColor = scene.clearColor;
		target.ignoreCameraViewport = true;
		await whenDrawable(scene, target, signal);
		scene.incrementRenderId();
		target.render(true);
		const pixels = await target.readPixels(0, 0, null, true, true);
		return pixels ? flipRows(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), size) : null;
	} finally {
		target.dispose();
	}
}

/** RGBA pixels (top row first) to a WebP of the wanted size, scaled with smoothing. */
async function pixelsToBlob(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, outWidth: number, outHeight: number): Promise<Blob | null> {
	const source = Object.assign(document.createElement('canvas'), { width, height });
	source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba) as ImageDataArray, width, height), 0, 0);
	const out = Object.assign(document.createElement('canvas'), { width: outWidth, height: outHeight });
	const context = out.getContext('2d')!;
	context.imageSmoothingQuality = 'high';
	context.drawImage(source, 0, 0, outWidth, outHeight);
	return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/webp', 0.85));
}

/** A square picture of an object or an avatar (a head-and-shoulders view for avatars), or null if there was nothing to draw. */
export async function renderObjectThumbnail(tree: SlotTree, kind: 'object' | 'avatar', options: RenderOptions = {}): Promise<Blob | null> {
	const stage = await buildStage(tree, options);
	try {
		if (options.signal?.cancelled) return null;
		const bounds = visibleBounds(stage.scene);
		if (!bounds) return null;
		const { target, radius } = kind === 'avatar' ? frameBounds(...(Object.values(bustBounds(bounds.min, bounds.max)) as [V3, V3])) : frameBounds(bounds.min, bounds.max);
		const camera = new ArcRotateCamera('thumbnail-camera', -Math.PI / 2.3, Math.PI / 2.6, radius, Vector3.FromArray(target), stage.scene);
		camera.fov = THUMBNAIL_FOV;
		camera.minZ = radius / 100;
		camera.maxZ = radius * 40;
		stage.scene.activeCamera = camera;
		// Drawn at twice the size and scaled down, for smooth edges.
		const big = OBJECT_SIZE * 2;
		const pixels = await drawTopDown(stage.scene, camera, big, options.signal);
		return pixels ? await pixelsToBlob(pixels, big, big, OBJECT_SIZE, OBJECT_SIZE) : null;
	} finally {
		stage.dispose();
	}
}

/** The floor height under the spawn, so the panorama is taken from eye height and not from inside the ground. */
function eyeHeightAtSpawn(stage: Stage): number {
	const floors = new Set<AbstractMesh>();
	for (const entry of stage.sceneGraph.allSlots()) if (isFloorSlot(entry.slot as Slot)) floors.add(entry.node as AbstractMesh);
	for (const mesh of floors) mesh.computeWorldMatrix(true);
	const hit = stage.scene.pickWithRay(new Ray(new Vector3(WORLD_SPAWN.x, 200, WORLD_SPAWN.z), Vector3.Down(), 400), (mesh) => floors.has(mesh));
	return (hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : 0) + EYE_HEIGHT;
}

/**
 * The six views from the spawn, each a square picture with a 90° field of view. Every face is looked at with the "up"
 * that the cube-map addressing in `cubeToEquirect` expects (+Y and -Y are looked at with -Z and +Z at the top).
 */
const PANORAMA_VIEWS: Array<{ look: V3; up: V3 }> = [
	{ look: [1, 0, 0], up: [0, 1, 0] }, // +X
	{ look: [-1, 0, 0], up: [0, 1, 0] }, // -X
	{ look: [0, 1, 0], up: [0, 0, -1] }, // +Y
	{ look: [0, -1, 0], up: [0, 0, 1] }, // -Y
	{ look: [0, 0, 1], up: [0, 1, 0] }, // +Z
	{ look: [0, 0, -1], up: [0, 1, 0] } // -Z
];

/** A 360° equirectangular picture of a world from its spawn: forward (+Z) in the middle, up at the top. */
export async function renderWorldPanorama(tree: SlotTree, options: RenderOptions = {}): Promise<Blob | null> {
	const stage = await buildStage(tree, options);
	try {
		if (options.signal?.cancelled) return null;
		const position = new Vector3(WORLD_SPAWN.x, eyeHeightAtSpawn(stage), WORLD_SPAWN.z);
		const camera = new FreeCamera('panorama-camera', position, stage.scene);
		camera.fov = Math.PI / 2;
		camera.minZ = 0.05;
		camera.maxZ = 2000;
		stage.scene.activeCamera = camera;
		const faces: Uint8Array[] = [];
		for (const view of PANORAMA_VIEWS) {
			if (options.signal?.cancelled) return null;
			camera.upVector = Vector3.FromArray(view.up);
			camera.setTarget(position.add(Vector3.FromArray(view.look)));
			const pixels = await drawTopDown(stage.scene, camera, CUBE_FACE, options.signal);
			if (!pixels) return null;
			faces.push(pixels);
		}
		const { width, height } = PANORAMA_SIZE;
		return await pixelsToBlob(cubeToEquirect(faces, CUBE_FACE, width, height), width, height, width, height);
	} finally {
		stage.dispose();
	}
}
