import {
	Color3,
	DepthRenderer,
	Matrix,
	Quaternion,
	RenderTargetTexture,
	StandardMaterial,
	UniversalCamera,
	Vector3,
	type AbstractMesh,
	type Scene,
	type TransformNode
} from '@babylonjs/core';
import type { CameraComponent } from '../ecs/types.ts';
import type { RadialItemDef } from './codeBlockRuntime.ts';
import { mirrorRenderHooks } from './mirrorHooks.ts';
import { encodeDepth, hasDepth } from './depthPhoto.ts';
import { createCameraUi, loadSettings, qualityFor, saveSettings, QUALITY_LONG_SIDE, QUALITY_LABEL, type CameraSettings } from './cameraSettingsUi.ts';

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
const EYE_SEPARATION = 0.045;
/**
 * How far away something has to be to sit on the screen (no difference between the eyes). Nearer comes out of it, farther goes behind.
 * Both eyes looking straight ahead, with nothing to bring their views together, make everything come out of the screen, and what is
 * near enough to touch is far too different between them to look at.
 */
const CONVERGENCE = 1.5;
/** How far a spatial photo's depth reaches (the camera's far plane while the depth is drawn); farther counts as nothing. */
const DEPTH_REACH = 12;
/** A spatial photo is taken wider than what it shows, by this much of the shown width on each side: what lies at its edge is there to be seen when it is turned. */
const SPATIAL_MARGIN = 0.25;
/** The side of a spatial photo's picture and of its depth map, margins included. */
const SPATIAL_SIDE = 640;

/** What a camera can ask of the world around it. */
export interface CameraHost {
	/**
	 * An instant print: the photo as a `data:image/jpeg` URL small enough to travel with the world. Each eye is cropped square;
	 * `sbs` holds a 3D photo's two (left, then right), `depth` a spatial photo's picture and then its depth map (taken wider than it shows: `inset` is the part of each side that is margin), `mono` is the one picture.
	 */
	onPrint?(photo: string, layout: 'mono' | 'sbs' | 'depth', inset?: number): void;
}

/** The side of the square print, in pixels. */
const PRINT_SIDE = 512;

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

/** Whether a picture is one flat colour (a target that nothing was drawn to). Looks at a spread of pixels, not all. */
function isBlank(picture: ImageData): boolean {
	const { data, width, height } = picture;
	const first = [data[0], data[1], data[2]];
	for (let i = 0; i < 400; i++) {
		const at = (Math.floor((i * 2654435761) % (width * height)) * 4) % data.length;
		if (Math.abs(data[at] - first[0]) > 3 || Math.abs(data[at + 1] - first[1]) > 3 || Math.abs(data[at + 2] - first[2]) > 3) return false;
	}
	return true;
}

/** The most characters a print's address may have (see PARAM_LIMITS.maxImage): a longer one is thrown away whole, and the print shows nothing. */
const MAX_PRINT_CHARS = 280_000;

/** The canvas as a JPEG address no longer than `MAX_PRINT_CHARS`: less quality first, then fewer pixels. */
function jpegWithin(source: HTMLCanvasElement): string {
	let canvas = source;
	for (let shrink = 0; shrink < 6; shrink++) {
		for (const quality of [0.8, 0.7, 0.6, 0.5]) {
			const url = canvas.toDataURL('image/jpeg', quality);
			if (url.length <= MAX_PRINT_CHARS) return url;
		}
		const smaller = document.createElement('canvas');
		smaller.width = Math.max(2, Math.floor(canvas.width * 0.8));
		smaller.height = Math.max(1, Math.floor(canvas.height * 0.8));
		smaller.getContext('2d')?.drawImage(canvas, 0, 0, smaller.width, smaller.height);
		canvas = smaller;
	}
	return canvas.toDataURL('image/jpeg', 0.4);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * A camera: the mesh is its screen. What lies in front of the screen (along its local +Z, the way the person holding it
 * looks) is drawn onto it live. The trigger takes a photo, or starts and stops a video, and the menu of the hand holding
 * it switches between the two. Pictures are saved on the device of the one holding the camera. Whatever the screen is
 * part of (the camera's body) is left out of the picture, so it does not look at itself.
 */
export function setupCameraSurface(scene: Scene, mesh: AbstractMesh, component: CameraComponent, host: CameraHost = {}): CameraBinding {
	const settings: CameraSettings = loadSettings(qualityFor(component.resolution ?? 960), component.output ?? 'instax');
	// The shape of the screen as it stands in the world, whatever its parent's scale.
	mesh.computeWorldMatrix(true);
	const worldScale = new Vector3();
	mesh.getWorldMatrix().decompose(worldScale);
	const aspect = Math.abs(worldScale.x) / Math.max(Math.abs(worldScale.y), 1e-6);
	let size = pictureSize(aspect, QUALITY_LONG_SIDE[settings.quality]);

	const camera = new UniversalCamera(`${mesh.name}-camera`, Vector3.Zero(), scene);
	camera.fov = FIELD_OF_VIEW;
	// The picture's own shape. The camera would take it from whatever the engine is drawing to when the target is rendered
	// (the headset's framebuffer in a session), which squashes the picture; so the projection is fixed to the target's shape.
	// An eye moved sideways by `eyeOffset` gets its view slid back the same way, so what lies at CONVERGENCE stays in the same place of the
	// picture for both eyes (an off-axis projection: the eyes look straight ahead, but their pictures are brought together).
	const fitProjection = (shape: { width: number; height: number }, eyeOffset = 0, zoom = 1) => {
		const projection = Matrix.Zero();
		const engine = scene.getEngine();
		Matrix.PerspectiveFovLHToRef(2 * Math.atan(Math.tan(FIELD_OF_VIEW / 2) * zoom), shape.width / shape.height, 0.15, 200, projection, true, engine.isNDCHalfZRange, undefined, engine.useReverseDepthBuffer);
		if (eyeOffset !== 0) {
			const values = projection.asArray().slice();
			values[8] += (values[0] * eyeOffset) / CONVERGENCE;
			Matrix.FromArrayToRef(values, 0, projection);
		}
		camera.freezeProjectionMatrix(projection);
	};
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
	fitProjection(size);

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

	/** `zoom` above 1 sees that much more of the scene round the same centre (a wider view); `shape` is the target's. */
	const draw = (target: RenderTargetTexture, eyeOffset = 0, zoom = 1, shape: { width: number; height: number } = size) => {
		place(eyeOffset);
		fitProjection(shape, eyeOffset, zoom);
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

	let disposed = false;
	let depthRenderer: DepthRenderer | null = null;
	/** Draws the photo's depth from where the screen is (inside the frame, with the pictures); `readDepth` reads it afterwards. */
	const drawDepth = (shape: { width: number; height: number }, zoom: number): void => {
		// Made when a spatial photo is first taken, and drawn by hand only: scene.enableDepthRenderer would draw it every frame.
		depthRenderer ??= new DepthRenderer(scene, undefined, camera);
		const map = depthRenderer.getDepthMap();
		const at = scene.customRenderTargets.indexOf(map);
		if (at >= 0) scene.customRenderTargets.splice(at, 1);
		if (map.getSize().width !== shape.width || map.getSize().height !== shape.height) map.resize(shape);
		place(0);
		fitProjection(shape, 0, zoom);
		relistIfNeeded(map);
		camera.maxZ = DEPTH_REACH;
		scene.incrementRenderId();
		mirrorRenderHooks.before.notifyObservers();
		try {
			map.render();
		} finally {
			mirrorRenderHooks.after.notifyObservers();
			camera.maxZ = 200;
		}
	};
	/** How many frames a depth map is given to show something: its shader compiles the first time it is used, and draws nothing until it has. */
	const DEPTH_ATTEMPTS = 180;
	const nextFrame = () => new Promise<void>((resolve) => { scene.onBeforeRenderObservable.addOnce(() => resolve()); });
	/** The photo's depth as a grey picture (see `encodeDepth`), drawn again each frame until the map holds something; null if it never does. */
	const readDepth = async (shape: { width: number; height: number }, zoom: number): Promise<ImageData | null> => {
		for (let attempt = 0; attempt < DEPTH_ATTEMPTS && !disposed; attempt++) {
			await nextFrame();
			drawDepth(shape, zoom);
			const pixels = (await depthRenderer!.getDepthMap().readPixels(0, 0, null, true, false)) as unknown as ArrayLike<number> | null;
			if (!pixels || pixels.length < shape.width * shape.height * 4 || !hasDepth(pixels, shape.width, shape.height)) continue;
			return new ImageData(encodeDepth(pixels, shape.width, shape.height) as Uint8ClampedArray<ArrayBuffer>, shape.width, shape.height);
		}
		console.warn('[camera] the depth of the photo could not be read; it is printed flat');
		return null;
	};

	/** How many frames a spatial photo's picture is given to show something. */
	const COLOR_ATTEMPTS = 90;
	/** The middle square of a picture, scaled to `side`: what a print shows of the screen's picture. */
	const middleSquare = (picture: ImageData, side: number): HTMLCanvasElement => {
		const whole = document.createElement('canvas');
		whole.width = picture.width;
		whole.height = picture.height;
		whole.getContext('2d')?.putImageData(picture, 0, 0);
		const square = Math.min(picture.width, picture.height);
		const out = document.createElement('canvas');
		out.width = out.height = side;
		out.getContext('2d')?.drawImage(whole, (picture.width - square) / 2, (picture.height - square) / 2, square, square, 0, 0, side, side);
		return out;
	};
	/**
	 * A spatial photo: the picture and its depth, both taken wider than they show (see SPATIAL_MARGIN) and cut square, as one JPEG with
	 * the picture on the left. They are drawn with the screen's own picture target, which is known to draw, only with a wider view: the
	 * middle square of it then holds the print and the margin round it. Without a depth it is printed as a plain picture.
	 */
	const takeSpatialPrint = async () => {
		const zoom = 1 + 2 * SPATIAL_MARGIN;
		// Drawn again each frame until it holds a picture, and the last one is kept if it never does.
		let picture: ImageData | null = null;
		for (let attempt = 0; attempt < COLOR_ATTEMPTS && !disposed; attempt++) {
			if (attempt > 0) await nextFrame();
			draw(preview, 0, zoom);
			picture = await readPicture(preview, size.width, size.height);
			if (picture && !isBlank(picture)) break;
		}
		if (!picture) return;
		const depth = await readDepth(size, zoom);
		const color = middleSquare(picture, SPATIAL_SIDE);
		if (depth) {
			const both = document.createElement('canvas');
			both.width = SPATIAL_SIDE * 2;
			both.height = SPATIAL_SIDE;
			const context = both.getContext('2d');
			if (!context) return;
			context.drawImage(color, 0, 0);
			context.drawImage(middleSquare(depth, SPATIAL_SIDE), SPATIAL_SIDE, 0);
			host.onPrint?.(jpegWithin(both), 'depth', SPATIAL_MARGIN / (1 + 2 * SPATIAL_MARGIN));
			return;
		}
		const shown = Math.round(SPATIAL_SIDE / zoom);
		const flat = document.createElement('canvas');
		flat.width = flat.height = PRINT_SIDE;
		flat.getContext('2d')?.drawImage(color, (SPATIAL_SIDE - shown) / 2, (SPATIAL_SIDE - shown) / 2, shown, shown, 0, 0, PRINT_SIDE, PRINT_SIDE);
		host.onPrint?.(jpegWithin(flat), 'mono');
	};

	let photoRequested = false;

	/**
	 * The photo is the screen's own picture, drawn afresh: what is saved is what the screen shows. Runs inside the frame,
	 * with the other drawing: both eyes of a 3D photo are drawn and their reading started here, before anything else is.
	 */
	const takePhoto = async () => {
		flashUntil = performance.now() + FLASH_MS;
		if (settings.format === 'spatial' && settings.output === 'instax' && host.onPrint) return takeSpatialPrint();
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
		canvas.width = width * pictures.length;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) return;
		pictures.forEach((picture, index) => context.putImageData(picture!, index * width, 0));
		if (settings.output === 'instax' && host.onPrint) {
			// The square in the middle of each eye's picture: the shape the screen frames while printing.
			const print = document.createElement('canvas');
			print.width = PRINT_SIDE * pictures.length;
			print.height = PRINT_SIDE;
			const side = Math.min(width, height);
			const printContext = print.getContext('2d');
			if (!printContext) return;
			pictures.forEach((_, index) => printContext.drawImage(canvas, index * width + (width - side) / 2, (height - side) / 2, side, side, index * PRINT_SIDE, 0, PRINT_SIDE, PRINT_SIDE));
			host.onPrint(jpegWithin(print), stereo ? 'sbs' : 'mono');
			return;
		}
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
			fitProjection(size);
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
			disposed = true;
			depthRenderer?.dispose();
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
				label: settings.output === 'instax' ? 'Output: Instax' : 'Output: Download',
				isEnabled: () => !!host.onPrint,
				onSelect: () => change({ output: settings.output === 'instax' ? 'download' : 'instax' })
			},
			{
				label: settings.format === '2d' ? 'Photo: 2D' : settings.format === '3d' ? 'Photo: 3D' : 'Photo: Spatial',
				isEnabled: () => true,
				onSelect: () => change({ format: settings.format === '2d' ? '3d' : settings.format === '3d' ? 'spatial' : '2d' })
			}
		]
	};
}
