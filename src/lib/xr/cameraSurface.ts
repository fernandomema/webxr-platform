import {
	Color3,
	Quaternion,
	RenderTargetTexture,
	StandardMaterial,
	UniversalCamera,
	Vector3,
	type AbstractMesh,
	type Scene,
	type TransformNode
} from '@babylonjs/core';
import type { CameraComponent } from '../ecs/types';
import type { RadialItemDef } from './codeBlockRuntime';
import { mirrorRenderHooks } from './mirrorHooks';
import { createCameraUi, loadSettings, qualityFor, saveSettings, QUALITY_LONG_SIDE, QUALITY_LABEL, type CameraSettings } from './cameraSettingsUi';

/** Further than this from the viewer, the screen is too small to read: it draws nothing and costs nothing. */
const PREVIEW_REACH = 6;
/** The preview (and a video) is redrawn this often. */
const FRAME_MS = 50;
/** Frames of a video per second. */
const VIDEO_FPS = 20;
const FIELD_OF_VIEW = 0.9;
/** How long the screen flashes white after a photo. */
const FLASH_MS = 160;
/** The distance between the two eyes of a 3D photo. */
const EYE_SEPARATION = 0.064;

export interface CameraBinding {
	dispose: () => void;
	/** The trigger of the hand holding the camera: a photo, or the start and the end of a video. Always taken. */
	onTrigger: () => boolean;
	/** The trigger, answered on this device: the picture is taken by the one holding the camera, not by whoever runs the world. */
	localUse: (phase: 'press' | 'release' | 'value') => void;
	getRadialItems: () => RadialItemDef[];
}

/** Rows come out of the GPU bottom first; a picture is read top first. */
export function flipRows(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
	const stride = width * 4;
	const out = new Uint8ClampedArray(pixels.length);
	for (let row = 0; row < height; row++) out.set(pixels.subarray((height - 1 - row) * stride, (height - row) * stride), row * stride);
	return out;
}

/** The size of a picture whose long side is `longSide` and whose shape is `aspect` (width over height). */
export function pictureSize(aspect: number, longSide: number): { width: number; height: number } {
	const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
	return safe >= 1
		? { width: longSide, height: Math.max(1, Math.round(longSide / safe)) }
		: { width: Math.max(1, Math.round(longSide * safe)), height: longSide };
}

function saveBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * A camera: the mesh is its screen. What lies in front of the screen (along its local +Z, the way the person holding it
 * looks) is drawn onto it live. The trigger takes a photo, or starts and stops a video, and the menu of the hand holding
 * it switches between the two. Pictures are saved on the device of the one holding the camera. Whatever the screen is
 * part of (the camera's body) is left out of the picture, so it does not look at itself.
 */
export function setupCameraSurface(scene: Scene, mesh: AbstractMesh, component: CameraComponent): CameraBinding {
	const settings: CameraSettings = loadSettings(qualityFor(component.resolution ?? 960));
	// The shape of the screen as it stands in the world, whatever its parent's scale.
	mesh.computeWorldMatrix(true);
	const worldScale = new Vector3();
	mesh.getWorldMatrix().decompose(worldScale);
	const aspect = Math.abs(worldScale.x) / Math.max(Math.abs(worldScale.y), 1e-6);
	let size = pictureSize(aspect, QUALITY_LONG_SIDE[settings.quality]);

	const camera = new UniversalCamera(`${mesh.name}-camera`, Vector3.Zero(), scene);
	camera.fov = FIELD_OF_VIEW;
	// Nothing nearer than this is drawn: the camera's own lens and body, and the fingers of whoever holds it.
	camera.minZ = 0.15;
	camera.maxZ = 200;
	camera.rotationQuaternion = Quaternion.Identity();
	// Not a view anyone looks through: it must never take the place of the player's own.
	camera.inputs.clear();

	const makeTarget = (width: number, height: number, name: string) => {
		const texture = new RenderTargetTexture(name, { width, height }, scene, { generateMipMaps: false, generateDepthBuffer: true });
		// Drawn here, by hand, before the frame itself starts (as a mirror is), and nowhere else.
		const at = scene.customRenderTargets.indexOf(texture);
		if (at >= 0) scene.customRenderTargets.splice(at, 1);
		texture.activeCamera = camera;
		return texture;
	};
	const preview = makeTarget(size.width, size.height, `${mesh.name}-preview`);

	const material = new StandardMaterial(`${mesh.name}-camera-material`, scene);
	material.disableLighting = true;
	material.backFaceCulling = false;
	// A texture's colour is ADDED to the emissive colour: it stays black, or the screen would be white whatever it shows.
	material.emissiveColor = Color3.Black();
	material.diffuseColor = Color3.Black();
	material.specularColor = Color3.Black();
	material.emissiveTexture = preview;
	mesh.material = material;
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'camera' };

	/** What the camera sees: everything but the camera itself (the screen's parent and all it carries, or just the screen). */
	const body: TransformNode = mesh.parent && 'getChildMeshes' in mesh.parent ? (mesh.parent as TransformNode) : mesh;
	let listedAt = -Infinity;
	const relist = () => {
		listedAt = -Infinity;
	};
	const added = scene.onNewMeshAddedObservable.add(relist);
	const removed = scene.onMeshRemovedObservable.add(relist);
	const relistIfNeeded = (target: RenderTargetTexture) => {
		const now = performance.now();
		if (now - listedAt < 500 && target.renderList) return;
		listedAt = now;
		const own = new Set<AbstractMesh>([mesh, ...body.getChildMeshes()]);
		target.renderList = scene.meshes.filter((candidate) => !own.has(candidate) && candidate.isEnabled() && candidate.isVisible && candidate.metadata?.specialSurface !== 'camera');
	};

	/** Puts the camera where the screen is, looking out of its back. */
	const place = (eyeOffset = 0) => {
		mesh.computeWorldMatrix(true);
		const rotation = new Quaternion();
		mesh.getWorldMatrix().decompose(undefined, rotation, camera.position);
		camera.rotationQuaternion = rotation;
		// An eye is the camera moved sideways, along its own right.
		if (eyeOffset !== 0) camera.position.addInPlace(Vector3.Right().applyRotationQuaternion(rotation).scale(eyeOffset));
	};

	const draw = (target: RenderTargetTexture, eyeOffset = 0) => {
		place(eyeOffset);
		relistIfNeeded(target);
		camera.outputRenderTarget = target;
		scene.incrementRenderId();
		// Like a mirror, this camera sees the player's own head, which is hidden from their own eyes.
		mirrorRenderHooks.before.notifyObservers();
		try {
			target.render();
		} finally {
			mirrorRenderHooks.after.notifyObservers();
			camera.outputRenderTarget = null;
		}
	};

	let recording: { recorder: MediaRecorder; chunks: Blob[]; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; reading: boolean; lastFrame: number } | null = null;
	let flashUntil = 0;
	let drawnAt = -Infinity;

	/** The target's picture, top row first; null if it cannot be read. */
	const readPicture = async (target: RenderTargetTexture, width: number, height: number): Promise<ImageData | null> => {
		const pixels = await target.readPixels(0, 0, null, true, false);
		if (!pixels) return null;
		const raw = pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
		if (raw.length < width * height * 4) return null;
		return new ImageData(flipRows(raw, width, height) as Uint8ClampedArray<ArrayBuffer>, width, height);
	};

	let photoRequested = false;

	/**
	 * The photo is the screen's own picture, drawn afresh: what is saved is what the screen shows. Runs inside the frame,
	 * with the other drawing: both eyes of a 3D photo are drawn and their reading started here, before anything else is.
	 */
	const takePhoto = async () => {
		flashUntil = performance.now() + FLASH_MS;
		const stereo = settings.format === '3d';
		const eyes = stereo ? [-EYE_SEPARATION / 2, EYE_SEPARATION / 2] : [0];
		const { width, height } = size;
		const reads = eyes.map((offset) => {
			draw(preview, offset);
			return readPicture(preview, width, height);
		});
		const pictures = await Promise.all(reads);
		if (pictures.some((picture) => !picture)) return;
		const canvas = document.createElement('canvas');
		canvas.width = width * eyes.length;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return;
		pictures.forEach((picture, index) => context.putImageData(picture!, index * width, 0));
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (blob) saveBlob(blob, `kithin-photo-${stamp()}${stereo ? '-3d-sbs' : ''}.png`);
	};

	const startVideo = () => {
		if (recording || typeof MediaRecorder === 'undefined') return;
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext('2d');
		if (!context) return;
		const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
		const recorder = new MediaRecorder(canvas.captureStream(VIDEO_FPS), type ? { mimeType: type } : undefined);
		const chunks: Blob[] = [];
		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		};
		recorder.onstop = () => {
			if (chunks.length === 0) return;
			const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
			saveBlob(blob, `kithin-video-${stamp()}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
		};
		recorder.start(1000);
		recording = { recorder, chunks, canvas, context, reading: false, lastFrame: 0 };
	};

	const stopVideo = () => {
		const active = recording;
		recording = null;
		if (active && active.recorder.state !== 'inactive') active.recorder.stop();
	};

	const FLASH = new Color3(1.5, 1.5, 1.5);
	const REC = new Color3(0.35, 0, 0);
	let glow: Color3 = Color3.Black();
	const frame = () => {
		const now = performance.now();
		const wanted = now < flashUntil ? FLASH : recording && Math.floor(now / 500) % 2 === 0 ? REC : Color3.Black();
		if (wanted !== glow) {
			glow = wanted;
			material.emissiveColor = wanted;
		}
		if (photoRequested) {
			photoRequested = false;
			void takePhoto().catch((error) => console.warn('[camera] the photo could not be taken', error));
		}
		if (now - drawnAt < FRAME_MS) return;
		const viewer = scene.activeCamera;
		const near = !!viewer && mesh.isEnabled() && Vector3.Distance(viewer.globalPosition, mesh.getAbsolutePosition()) < PREVIEW_REACH;
		// A video keeps being drawn whoever looks; a screen nobody can see is left as it was.
		if (!near && !recording) return;
		drawnAt = now;
		draw(preview);
		const active = recording;
		if (active && !active.reading && now - active.lastFrame >= 1000 / VIDEO_FPS) {
			active.reading = true;
			active.lastFrame = now;
			void readPicture(preview, size.width, size.height)
				.then((picture) => {
					if (picture) active.context.putImageData(picture, 0, 0);
				})
				.finally(() => {
					active.reading = false;
				});
		}
	};
	const observer = scene.onBeforeRenderObservable.add(() => {
		try {
			frame();
		} catch (error) {
			console.warn('[camera] the screen could not be drawn', error);
		}
	});

	const press = () => {
		if (settings.mode === 'photo') photoRequested = true;
		else if (recording) stopVideo();
		else startVideo();
	};

	/** Applies a change from the screen's controls or the hand's menu. */
	const change = (patch: Partial<CameraSettings>) => {
		const before = settings.quality;
		Object.assign(settings, patch);
		if (settings.quality !== before) {
			size = pictureSize(aspect, QUALITY_LONG_SIDE[settings.quality]);
			preview.resize(size);
		}
		saveSettings(settings);
		ui.refresh();
	};
	const ui = createCameraUi(scene, mesh, aspect, { get: () => settings, set: change, isRecording: () => !!recording });

	return {
		dispose: () => {
			ui.dispose();
			scene.onBeforeRenderObservable.remove(observer);
			scene.onNewMeshAddedObservable.remove(added);
			scene.onMeshRemovedObservable.remove(removed);
			stopVideo();
			material.dispose();
			preview.dispose();
			camera.dispose();
		},
		onTrigger: () => true,
		localUse: (phase) => {
			if (phase === 'press') press();
		},
		getRadialItems: () => [
			{
				label: recording ? 'Stop recording' : settings.mode === 'photo' ? 'Mode: Photo' : 'Mode: Video',
				isEnabled: () => true,
				onSelect: () => {
					if (recording) {
						stopVideo();
						ui.refresh();
					} else change({ mode: settings.mode === 'photo' ? 'video' : 'photo' });
				}
			},
			{
				label: `Quality: ${QUALITY_LABEL[settings.quality]}`,
				isEnabled: () => !recording,
				onSelect: () => change({ quality: settings.quality === 'low' ? 'medium' : settings.quality === 'medium' ? 'high' : 'low' })
			},
			{
				label: settings.format === '2d' ? 'Photo: 2D' : 'Photo: 3D',
				isEnabled: () => true,
				onSelect: () => change({ format: settings.format === '2d' ? '3d' : '2d' })
			}
		]
	};
}
