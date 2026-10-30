import { Color3, GizmoManager, Matrix, Mesh, MeshBuilder, PointerDragBehavior, Quaternion, StandardMaterial, Vector3, type Camera, type Scene, type TransformNode } from '@babylonjs/core';
import { drawnBox } from './colliderBoxHelper';
import { EDITOR_ONLY } from './previewCameraHelper';
import { bindTransformSnapping, SNAP_PRECISIONS, type SnapPrecision } from './transformSnapping';

export type TransformMode = 'move' | 'rotate' | 'scale';
/** How `scale` works: `axes` stretches along the three axes; `corners` drags one of the 8 corners of the bounds while the opposite corner stays put. */
export type ScaleStyle = 'axes' | 'corners';
type Position = [number, number, number];
type Rotation = [number, number, number, number];

/** Transform handles for ordinary Studio slots, including empty hierarchy nodes. */
export class SelectionTransformHelper {
	private readonly gizmos: GizmoManager;
	private readonly disposeSnapping: () => void;
	private readonly wired = new Set<unknown>();
	private selectedId: string | null = null;
	private dragging = false;
	private lastDragEnd = -Infinity;
	private dragTarget: { id: string; node: TransformNode } | null = null;
	private corners: CornerHandles | null = null;

	constructor(scene: Scene, private canvas: HTMLCanvasElement, private camera: Camera, private options: {
		getSnapPrecision?: () => SnapPrecision;
		getNode(id: string): TransformNode | undefined;
		onChanged(id: string, position: Position, rotation: Rotation, scale: Position): void;
	}) {
		this.gizmos = new GizmoManager(scene);
		this.gizmos.usePointerToAttachGizmos = false;
		this.disposeSnapping = bindTransformSnapping(scene, this.gizmos, undefined, this.options.getSnapPrecision);
		this.corners = new CornerHandles(scene, canvas, camera, {
			getSnapStep: () => SNAP_PRECISIONS[this.options.getSnapPrecision?.() ?? 'medium'].scale,
			onDragging: (dragging) => {
				this.dragging = dragging;
				if (dragging) this.camera.detachControl();
				else { this.camera.attachControl(this.canvas, true); this.lastDragEnd = performance.now(); }
			},
			onChanged: (node) => {
				const id = this.selectedId;
				if (!id || this.options.getNode(id) !== node) return;
				this.options.onChanged(id, node.position.asArray() as Position,
					(node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).asArray() as Rotation,
					node.scaling.asArray() as Position);
			}
		});
	}

	update(id: string | null, mode: TransformMode, scaleStyle: ScaleStyle = 'axes'): void {
		this.selectedId = id;
		const node = id ? this.options.getNode(id) : undefined;
		if (this.dragTarget && (this.dragTarget.id !== id || this.dragTarget.node !== node)) {
			this.dragTarget = null;
			this.dragging = false;
			this.camera.attachControl(this.canvas, true);
			this.lastDragEnd = performance.now();
		}
		this.gizmos.positionGizmoEnabled = Boolean(node) && mode === 'move';
		this.gizmos.rotationGizmoEnabled = Boolean(node) && mode === 'rotate';
		if (this.gizmos.gizmos.rotationGizmo) {
			// Babylon rejects local rotation handles on non-uniformly scaled nodes.
			this.gizmos.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
		}
		this.gizmos.scaleGizmoEnabled = Boolean(node) && mode === 'scale' && scaleStyle === 'axes';
		this.corners?.attach(node && mode === 'scale' && scaleStyle === 'corners' ? node : null);
		this.wire(this.gizmos.gizmos.positionGizmo);
		this.wire(this.gizmos.gizmos.rotationGizmo);
		this.wire(this.gizmos.gizmos.scaleGizmo);
		this.gizmos.attachToNode(node ?? null);
	}

	isDragging(): boolean { return this.dragging; }
	recentlyDragged(): boolean { return performance.now() - this.lastDragEnd < 300; }

	private wire(gizmo: { onDragStartObservable: { add(f: () => void): unknown }; onDragEndObservable: { add(f: () => void): unknown } } | null | undefined): void {
		if (!gizmo || this.wired.has(gizmo)) return;
		this.wired.add(gizmo);
		gizmo.onDragStartObservable.add(() => {
			const id = this.selectedId;
			const node = id ? this.options.getNode(id) : undefined;
			if (!id || !node) return;
			this.dragTarget = { id, node };
			this.dragging = true;
			this.camera.detachControl();
		});
		gizmo.onDragEndObservable.add(() => {
			const target = this.dragTarget;
			if (!target) return;
			this.dragTarget = null;
			this.dragging = false;
			this.camera.attachControl(this.canvas, true);
			this.lastDragEnd = performance.now();
			if (!target || target.id !== this.selectedId || target.node.isDisposed() || this.options.getNode(target.id) !== target.node) return;
			// Babylon updates local transforms even when the slot has a transformed parent.
			this.options.onChanged(target.id, target.node.position.asArray() as Position,
				(target.node.rotationQuaternion ?? Quaternion.FromEulerVector(target.node.rotation)).asArray() as Rotation,
				target.node.scaling.asArray() as Position);
		});
	}

	dispose(): void {
		this.disposeSnapping();
		this.corners?.dispose();
		if (this.dragging) this.camera.attachControl(this.canvas, true);
		this.dragging = false;
		this.dragTarget = null;
		this.gizmos.dispose();
	}
}

type Vec3 = [number, number, number];

/**
 * Eight handles on the corners of an object's bounds. Dragging one rescales the object so that the opposite corner stays where it is
 * (the position is adjusted to match), which resizes boxes without moving them. Alt keeps the proportions, Shift snaps the new scale.
 */
class CornerHandles {
	private readonly handles: Mesh[] = [];
	private readonly material: StandardMaterial;
	private node: TransformNode | null = null;
	private min = Vector3.Zero();
	private max = Vector3.Zero();
	private dragging = false;
	private shift = false;
	private alt = false;
	private readonly observer;
	private readonly onKey = (event: Event) => {
		const { shiftKey, altKey } = event as KeyboardEvent;
		this.shift = shiftKey;
		this.alt = altKey;
	};

	constructor(private scene: Scene, private canvas: HTMLCanvasElement, private camera: Camera, private options: {
		getSnapStep(): number;
		onDragging(dragging: boolean): void;
		onChanged(node: TransformNode): void;
	}) {
		this.material = new StandardMaterial('corner-handle-material', scene);
		this.material.emissiveColor = Color3.FromHexString('#f59e0b');
		this.material.disableLighting = true;
		this.material.disableDepthWrite = true;
		this.material.depthFunction = 519; // ALWAYS: stay visible through the object
		for (let index = 0; index < 8; index++) {
			const handle = MeshBuilder.CreateBox(`corner-handle-${index}`, { size: 1 }, scene);
			handle.material = this.material;
			handle.layerMask = EDITOR_ONLY;
			handle.renderingGroupId = 1;
			handle.setEnabled(false);
			this.handles.push(handle);
			this.bindDrag(handle, index);
		}
		for (const name of ['keydown', 'keyup', 'pointerdown', 'pointermove']) window.addEventListener(name, this.onKey, { capture: true });
		this.observer = scene.onBeforeRenderObservable.add(() => this.place());
	}

	/** Shows the handles on `node` (null: hides them). */
	attach(node: TransformNode | null): void {
		if (this.dragging && node === this.node) return;
		this.node = node;
		for (const handle of this.handles) handle.setEnabled(Boolean(node));
		if (!node) return;
		const box = drawnBox(node);
		this.min = new Vector3(...box.center).subtractInPlace(new Vector3(...box.size).scaleInPlace(0.5));
		this.max = new Vector3(...box.center).addInPlace(new Vector3(...box.size).scaleInPlace(0.5));
	}

	/** Corner `index` in the node's own space before its scale; bit 0 is x, bit 1 is y, bit 2 is z, set meaning the max side. */
	private corner(index: number, opposite = false): Vector3 {
		const pick = (bit: number, lo: number, hi: number) => (((index >> bit) & 1) === 1) !== opposite ? hi : lo;
		return new Vector3(pick(0, this.min.x, this.max.x), pick(1, this.min.y, this.max.y), pick(2, this.min.z, this.max.z));
	}

	private place(): void {
		const node = this.node;
		if (!node || node.isDisposed()) return;
		node.computeWorldMatrix(true);
		const world = node.getWorldMatrix();
		this.handles.forEach((handle, index) => {
			handle.position = Vector3.TransformCoordinates(this.corner(index), world);
			handle.scaling.setAll(Vector3.Distance(this.camera.globalPosition, handle.position) * 0.018);
		});
	}

	private bindDrag(handle: Mesh, index: number): void {
		const drag = new PointerDragBehavior();
		drag.moveAttached = false;
		drag.useObjectOrientationForDragging = false;
		let start: { node: TransformNode; world: Matrix; inverse: Matrix; position: Vector3; rotation: Quaternion; scale: Vector3; grab: Vector3; anchor: Vector3; corner: Vector3; cornerWorld: Vector3 } | null = null;
		drag.onDragStartObservable.add((event) => {
			const node = this.node;
			if (!node) return;
			node.computeWorldMatrix(true);
			const world = node.getWorldMatrix().clone();
			const corner = this.corner(index);
			start = {
				node, world, inverse: world.clone().invert(), position: node.position.clone(), scale: node.scaling.clone(),
				rotation: (node.rotationQuaternion ?? Quaternion.FromEulerVector(node.rotation)).clone(),
				grab: event.dragPlanePoint.clone(), anchor: this.corner(index, true), corner, cornerWorld: Vector3.TransformCoordinates(corner, world)
			};
			if (!node.rotationQuaternion) node.rotationQuaternion = start.rotation.clone();
			this.dragging = true;
			this.options.onDragging(true);
		});
		drag.onDragObservable.add((event) => {
			if (!start) return;
			const { node, anchor, corner } = start;
			const target = Vector3.TransformCoordinates(start.cornerWorld.add(event.dragPlanePoint.subtract(start.grab)), start.inverse);
			const span = corner.subtract(anchor);
			const moved = target.subtract(anchor);
			const along = (value: number, size: number) => (Math.abs(size) < 1e-6 ? 1 : value / size);
			let factor = [along(moved.x, span.x), along(moved.y, span.y), along(moved.z, span.z)];
			if (this.alt) {
				const length = span.lengthSquared();
				const uniform = length < 1e-9 ? 1 : Vector3.Dot(moved, span) / length;
				factor = [uniform, uniform, uniform];
			}
			const step = this.options.getSnapStep();
			const scale = start.scale.asArray().map((value, axis) => {
				let next = value * factor[axis];
				if (this.shift && step > 0) next = Math.round(next / step) * step;
				// A handle dragged through the opposite corner must not flip the object inside out.
				return Math.sign(next || 1) * Math.max(0.001, Math.abs(next));
			}) as Vec3;
			// The anchor sits at rotation * (scale * anchor) from the position, so keeping it fixed moves the position by the change.
			const before = start.scale.multiply(anchor).applyRotationQuaternion(start.rotation);
			const after = new Vector3(...scale).multiplyInPlace(anchor).applyRotationQuaternion(start.rotation);
			node.scaling.copyFromFloats(...scale);
			node.position.copyFrom(start.position.add(before).subtract(after));
		});
		drag.onDragEndObservable.add(() => {
			const done = start;
			start = null;
			this.dragging = false;
			this.options.onDragging(false);
			if (done && !done.node.isDisposed()) this.options.onChanged(done.node);
		});
		handle.addBehavior(drag);
	}

	dispose(): void {
		for (const name of ['keydown', 'keyup', 'pointerdown', 'pointermove']) window.removeEventListener(name, this.onKey, { capture: true });
		this.scene.onBeforeRenderObservable.remove(this.observer);
		for (const handle of this.handles) handle.dispose();
		this.material.dispose();
	}
}
