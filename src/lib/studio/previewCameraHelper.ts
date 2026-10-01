import {
	Color3,
	Color4,
	FreeCamera,
	GizmoManager,
	MeshBuilder,
	Quaternion,
	RenderTargetTexture,
	StandardMaterial,
	TransformNode,
	Vector3,
	type Camera,
	type LinesMesh,
	type Mesh,
	type Scene
} from '@babylonjs/core';
import { INSET_MARGIN, cameraBodyLines, frustumLines, insetPixels, type Polyline } from './previewCameraGeometry';
import { bindTransformSnapping, type SnapPrecision } from './transformSnapping';

/**
 * How the Studio shows and edits a "Preview camera" slot, the way an engine editor does for its cameras: the frustum drawn in
 * the viewport, move and rotate handles on the selected one, and a live view through it in a corner, so the picture can be
 * framed by eye. The handles write their result back through `onMoved`.
 */

/** Things on this layer are drawn in the editor's own view only, never in the live camera view. */
export const EDITOR_ONLY = 0x10000000;
const SCENE_LAYERS = 0x0fffffff;
const VIEW_RESOLUTION = 384;
const SELECTED = Color3.FromHexString('#38bdf8');
const OTHER = Color3.FromHexString('#64748b');

export type GizmoMode = 'move' | 'rotate';

export interface HelperCamera {
	id: string;
	/** Vertical field of view in degrees. */
	fov: number;
}

interface Entry {
	root: TransformNode;
	frustum: LinesMesh;
	body: LinesMesh;
	pick: Mesh;
	fov: number;
}

export class PreviewCameraHelper {
	private entries = new Map<string, Entry>();
	private selectedId: string | null = null;
	private mode: GizmoMode = 'move';
	private lastDragEnd = 0;
	private dragging = false;
	private readonly gizmos: GizmoManager;
	private readonly disposeSnapping: () => void;
	private readonly liveCamera: FreeCamera;
	private readonly target: RenderTargetTexture;
	/** A screen-sized square stuck to the editor camera that shows the live view. */
	private readonly screen: Mesh;
	private readonly screenMaterial: StandardMaterial;
	private readonly observer;
	private wired = new Set<unknown>();

	constructor(
		private scene: Scene,
		private canvas: HTMLCanvasElement,
		private orbit: Camera,
		private options: {
			getSnapPrecision?: () => SnapPrecision;
		getNode(slotId: string): TransformNode | undefined;
			onMoved(slotId: string, position: [number, number, number], rotation: [number, number, number, number]): void;
		}
	) {
		// The editor's camera sees the helper layer as well as the scene; the live camera sees only the scene.
		orbit.layerMask = SCENE_LAYERS | EDITOR_ONLY;
		this.liveCamera = new FreeCamera('preview-live-camera', Vector3.Zero(), scene);
		this.liveCamera.layerMask = SCENE_LAYERS;
		this.liveCamera.minZ = 0.02;
		this.liveCamera.maxZ = 500;
		if (scene.activeCamera !== orbit) scene.activeCamera = orbit;

		this.target = new RenderTargetTexture('preview-live-view', { width: VIEW_RESOLUTION, height: VIEW_RESOLUTION }, scene, false, false); // false: use this square's own aspect, not the canvas's
		this.target.activeCamera = this.liveCamera;
		this.target.clearColor = new Color4(0.09, 0.1, 0.14, 1);
		this.target.ignoreCameraViewport = true;
		this.screenMaterial = new StandardMaterial('preview-live-screen-material', scene);
		this.screenMaterial.disableLighting = true;
		this.screenMaterial.diffuseColor = Color3.Black();
		this.screenMaterial.specularColor = Color3.Black();
		this.screenMaterial.emissiveTexture = this.target;
		this.screenMaterial.backFaceCulling = false;
		this.screen = MeshBuilder.CreatePlane('preview-live-screen', { size: 1 }, scene);
		this.screen.material = this.screenMaterial;
		this.screen.parent = orbit;
		this.screen.layerMask = EDITOR_ONLY;
		this.screen.renderingGroupId = 1; // drawn over the scene, with the depth cleared
		this.screen.isPickable = false;
		this.screen.setEnabled(false);

		this.gizmos = new GizmoManager(scene);
		this.gizmos.usePointerToAttachGizmos = false;
		this.disposeSnapping = bindTransformSnapping(scene, this.gizmos, undefined, this.options.getSnapPrecision);
		this.observer = scene.onBeforeRenderObservable.add(() => this.frame());
	}

	setMode(mode: GizmoMode): void {
		this.mode = mode;
		this.applySelection();
	}

	/** True while a handle is being dragged: the viewport's own drag-to-pan must stand still meanwhile. */
	isDragging(): boolean {
		return this.dragging;
	}

	/** True for a moment after a handle was let go, so the click that ends a drag is not taken as a selection. */
	recentlyDragged(): boolean {
		return performance.now() - this.lastDragEnd < 300;
	}

	update(cameras: readonly HelperCamera[], selectedId: string | null): void {
		const wanted = new Set(cameras.map((camera) => camera.id));
		for (const [id, entry] of this.entries) {
			if (!wanted.has(id)) {
				this.disposeEntry(entry);
				this.entries.delete(id);
			}
		}
		for (const camera of cameras) {
			let entry = this.entries.get(camera.id);
			if (entry && entry.fov !== camera.fov) {
				entry.frustum.dispose();
				entry.frustum = this.lines(`preview-camera-frustum-${camera.id}`, frustumLines(camera.fov), entry.root);
				entry.fov = camera.fov;
			}
			if (!entry) entry = this.create(camera);
			const colour = camera.id === selectedId ? SELECTED : OTHER;
			entry.frustum.color = colour;
			entry.body.color = colour;
		}
		this.selectedId = selectedId && this.entries.has(selectedId) ? selectedId : null;
		if (this.selectedId) this.liveCamera.fov = (this.entries.get(this.selectedId)!.fov * Math.PI) / 180;
		this.applySelection();
	}

	private lines(name: string, polylines: Polyline[], parent: TransformNode): LinesMesh {
		const mesh = MeshBuilder.CreateLineSystem(name, { lines: polylines.map((line) => line.map((p) => Vector3.FromArray(p))) }, this.scene);
		mesh.parent = parent;
		mesh.layerMask = EDITOR_ONLY;
		mesh.isPickable = false;
		return mesh;
	}

	private create(camera: HelperCamera): Entry {
		const root = new TransformNode(`preview-camera-${camera.id}`, this.scene);
		const frustum = this.lines(`preview-camera-frustum-${camera.id}`, frustumLines(camera.fov), root);
		const body = this.lines(`preview-camera-body-${camera.id}`, cameraBodyLines(), root);
		// An invisible box round the body, so clicking the camera in the viewport selects it.
		const pick = MeshBuilder.CreateBox(`preview-camera-pick-${camera.id}`, { size: 0.24 }, this.scene);
		pick.parent = root;
		pick.position.z = -0.02;
		pick.visibility = 0;
		pick.layerMask = EDITOR_ONLY;
		pick.metadata = { slotId: camera.id };
		const entry: Entry = { root, frustum, body, pick, fov: camera.fov };
		this.entries.set(camera.id, entry);
		return entry;
	}

	private disposeEntry(entry: Entry): void {
		entry.frustum.dispose();
		entry.body.dispose();
		entry.pick.dispose();
		entry.root.dispose();
	}

	/** Handles and the live view belong to the selected camera only. */
	private applySelection(): void {
		const id = this.selectedId;
		const node = id ? this.options.getNode(id) : undefined;
		this.gizmos.positionGizmoEnabled = Boolean(node) && this.mode === 'move';
		this.gizmos.rotationGizmoEnabled = Boolean(node) && this.mode === 'rotate';
		this.wire(this.gizmos.gizmos.positionGizmo);
		this.wire(this.gizmos.gizmos.rotationGizmo);
		this.gizmos.attachToNode(node ?? null);
		const live = Boolean(node);
		this.screen.setEnabled(live);
		const targets = this.scene.customRenderTargets;
		const listed = targets.includes(this.target);
		if (live && !listed) targets.push(this.target);
		if (!live && listed) targets.splice(targets.indexOf(this.target), 1);
	}

	/** Hooks a handle's start and end of drag, once: the editor camera must not orbit while a handle is dragged, and the result is stored at the end. */
	private wire(gizmo: { onDragStartObservable: { add(f: () => void): unknown }; onDragEndObservable: { add(f: () => void): unknown } } | null | undefined): void {
		if (!gizmo || this.wired.has(gizmo)) return;
		this.wired.add(gizmo);
		gizmo.onDragStartObservable.add(() => {
			this.dragging = true;
			this.orbit.detachControl();
		});
		gizmo.onDragEndObservable.add(() => {
			this.dragging = false;
			this.orbit.attachControl(this.canvas, true);
			this.lastDragEnd = performance.now();
			const id = this.selectedId;
			const node = id ? this.options.getNode(id) : undefined;
			if (id && node) this.options.onMoved(id, node.position.asArray() as [number, number, number], (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as [number, number, number, number]);
		});
	}

	private frame(): void {
		const scale = new Vector3();
		const rotation = new Quaternion();
		const position = new Vector3();
		for (const [id, entry] of this.entries) {
			const node = this.options.getNode(id);
			entry.root.setEnabled(Boolean(node));
			if (!node) continue;
			node.computeWorldMatrix(true);
			node.getWorldMatrix().decompose(scale, rotation, position);
			entry.root.position.copyFrom(position);
			entry.root.rotationQuaternion = rotation.clone();
			if (id === this.selectedId) {
				this.liveCamera.position.copyFrom(position);
				this.liveCamera.rotationQuaternion = rotation.clone();
				// Only the scene's active camera is brought up to date on its own; this one has to be asked, or it keeps its old direction.
				this.liveCamera.update();
				// A texture that renders this camera asks it for its matrices without checking that they moved, so they are recomputed here.
				this.liveCamera.getViewMatrix(true);
				this.liveCamera.getProjectionMatrix(true);
			}
		}
		if (!this.screen.isEnabled()) return;
		// The live view leaves out what only the editor shows (the grid, the handles, the frustums).
		this.target.renderList = this.scene.meshes.filter((mesh) => (mesh.layerMask & SCENE_LAYERS) !== 0 && mesh.isEnabled());
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		const size = insetPixels(width, height);
		// One unit in front of the editor camera; a pixel there is `perPixel` units, the same across and up.
		const halfHeight = Math.tan(this.orbit.fov / 2);
		const perPixel = (2 * halfHeight) / height;
		const halfWidth = (halfHeight * width) / height;
		const centre = INSET_MARGIN + size / 2;
		this.screen.position.set(halfWidth - centre * perPixel, -halfHeight + centre * perPixel, 1);
		this.screen.scaling.set(size * perPixel, size * perPixel, 1);
	}

	dispose(): void {
		this.disposeSnapping();
		this.scene.onBeforeRenderObservable.remove(this.observer);
		const targets = this.scene.customRenderTargets;
		if (targets.includes(this.target)) targets.splice(targets.indexOf(this.target), 1);
		this.gizmos.dispose();
		this.screen.dispose();
		this.screenMaterial.dispose();
		this.target.dispose();
		this.liveCamera.dispose();
		for (const entry of this.entries.values()) this.disposeEntry(entry);
		this.entries.clear();
	}
}
