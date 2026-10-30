import { Color3, MeshBuilder, StandardMaterial, TransformNode, type AbstractMesh, type Camera, type Mesh, type Scene } from '@babylonjs/core';

/**
 * A loading screen made of scene meshes instead of page elements, so it shows in a headset as well as on the screen: a dark sphere round
 * the viewer's head that hides the world while it is being built, and in front of the face a ring of dots that chase each other. It comes in and
 * goes out with a soft fade (the ring swells and shrinks with it), hangs from the camera, and is redrawn every frame, so it keeps moving as
 * long as the frames do.
 */
export interface WorldLoadCover {
	/** Fades the cover in; resolves once it hides the view completely (what is behind may then be taken down without being seen). */
	show(): Promise<void>;
	/** Fades the cover out; resolves when it is gone. */
	hide(): Promise<void>;
	dispose(): void;
}

const COVER_GROUP = 2; // the sphere; the dots are in the next group, which starts with a clear depth buffer, so they are drawn over it
const DOTS_GROUP = 3;
const DOTS = 12;
const RING_RADIUS = 0.06;
/** Far enough to be looked at, not into: close things in a headset are tiring. */
const DISTANCE = 3.4;
const FADE_IN_MS = 550;
const FADE_OUT_MS = 750;

export function createWorldLoadCover(scene: Scene, getCamera: () => Camera): WorldLoadCover {
	const sphere = MeshBuilder.CreateSphere('load-cover', { diameter: 8, segments: 8 }, scene);
	sphere.isPickable = false;
	sphere.renderingGroupId = COVER_GROUP;
	sphere.alwaysSelectAsActiveMesh = true;
	const dark = new StandardMaterial('load-cover', scene);
	dark.disableLighting = true;
	dark.emissiveColor = new Color3(0.02, 0.025, 0.06);
	dark.backFaceCulling = false;
	dark.disableDepthWrite = true;
	sphere.material = dark;

	const root = new TransformNode('load-cover-dots', scene);
	// In the camera's own space: Z is where it looks. A little below the middle of the view, at a distance that is easy on the eyes.
	const APPARENT = DISTANCE / 0.9; // the sizes below are drawn for 0.9 m; this keeps them looking the same from further away
	root.position.set(0, -0.06 * APPARENT, DISTANCE);
	const light = new StandardMaterial('load-cover-dot', scene);
	light.disableLighting = true;
	light.emissiveColor = new Color3(1, 0.62, 0.2);
	light.disableDepthWrite = true;
	const parts: Mesh[] = [];
	const part = (name: string, size: { width: number; height: number; depth: number }, material: StandardMaterial): Mesh => {
		const mesh = MeshBuilder.CreateBox(name, size, scene);
		mesh.isPickable = false;
		mesh.renderingGroupId = DOTS_GROUP;
		mesh.alwaysSelectAsActiveMesh = true;
		mesh.material = material;
		mesh.parent = root;
		parts.push(mesh);
		return mesh;
	};
	const dots = Array.from({ length: DOTS }, (_, i) => {
		const dot = part(`load-cover-dot-${i}`, { width: 0.016, height: 0.016, depth: 0.004 }, light);
		const angle = (i / DOTS) * Math.PI * 2;
		dot.position.set(Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0);
		return dot;
	});

	const all: AbstractMesh[] = [sphere, ...parts];
	const setEnabled = (on: boolean) => { for (const mesh of all) mesh.setEnabled(on); };
	setEnabled(false);

	let level = 0; // how much of the cover is showing, 0 to 1
	let target = 0;
	let phase = 0;
	let waiting: Array<() => void> = [];

	const observer = scene.onBeforeRenderObservable.add(() => {
		if (level === 0 && target === 0) return;
		const dt = scene.getEngine().getDeltaTime();
		level = target > level ? Math.min(target, level + dt / FADE_IN_MS) : Math.max(target, level - dt / FADE_OUT_MS);
		if (level === target) {
			if (target === 0) setEnabled(false);
			const done = waiting;
			waiting = [];
			for (const resolve of done) resolve();
		}
		// Hung from the camera, so that it stays where it is on the face whatever the rig does (moves, turns, is scaled).
		const camera = getCamera();
		if (root.parent !== camera) {
			root.parent = camera;
			sphere.parent = camera;
		}
		phase = (phase + dt / 900) % 1;
		for (let i = 0; i < DOTS; i++) {
			const behind = (phase - i / DOTS + 1) % 1;
			dots[i].scaling.setAll(0.4 + 1.3 * (1 - behind) ** 3);
		}
	});

	const reach = (to: number, limitMs: number): Promise<void> =>
		new Promise((resolve) => {
			target = to;
			if (to > 0) setEnabled(true);
			if (level === to) return resolve();
			// Frames that stop (a tab in the background) must not hold the load.
			const timer = setTimeout(resolve, limitMs);
			waiting.push(() => { clearTimeout(timer); resolve(); });
		});

	return {
		show() {
			return reach(1, FADE_IN_MS * 3);
		},
		hide() {
			return reach(0, FADE_OUT_MS * 3).then(() => setEnabled(false));
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(observer);
			for (const mesh of all) mesh.dispose();
			dark.dispose();
			light.dispose();
			root.dispose();
		}
	};
}
