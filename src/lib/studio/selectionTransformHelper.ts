import { GizmoManager, Quaternion, type Camera, type Scene, type TransformNode } from '@babylonjs/core';
import { bindTransformSnapping, type SnapPrecision } from './transformSnapping';

export type TransformMode = 'move' | 'rotate' | 'scale';
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

	constructor(scene: Scene, private canvas: HTMLCanvasElement, private camera: Camera, private options: {
		getSnapPrecision?: () => SnapPrecision;
		getNode(id: string): TransformNode | undefined;
		onChanged(id: string, position: Position, rotation: Rotation, scale: Position): void;
	}) {
		this.gizmos = new GizmoManager(scene);
		this.gizmos.usePointerToAttachGizmos = false;
		this.disposeSnapping = bindTransformSnapping(scene, this.gizmos, undefined, this.options.getSnapPrecision);
	}

	update(id: string | null, mode: TransformMode): void {
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
		this.gizmos.scaleGizmoEnabled = Boolean(node) && mode === 'scale';
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
		if (this.dragging) this.camera.attachControl(this.canvas, true);
		this.dragging = false;
		this.dragTarget = null;
		this.gizmos.dispose();
	}
}
