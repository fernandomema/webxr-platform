import {
	Color3,
	GizmoManager,
	MeshBuilder,
	TransformNode,
	Vector3,
	type Camera,
	type LinesMesh,
	type Scene
} from '@babylonjs/core';
import { boxLines } from '@kithin/engine/xr/dropZoneGeometry';
import { EDITOR_ONLY } from './previewCameraHelper';
import { bindTransformSnapping, type SnapPrecision } from './transformSnapping';

/**
 * How the Studio edits the box of a `collider`: the box drawn on the selected object, with move and scale handles on it. The box lives
 * in the object's own space (before the object's scale), the same space `center` and `size` are stored in, so a stand-in node parented to
 * the object has exactly those as its position and scale and the handles just write them back through `onChanged`.
 */

const COLOUR = Color3.FromHexString('#f59e0b');

export type ColliderGizmoMode = 'move' | 'scale';
type Vec3 = [number, number, number];

export class ColliderBoxHelper {
	private box: TransformNode | null = null;
	private edges: LinesMesh | null = null;
	private slotId: string | null = null;
	private mode: ColliderGizmoMode = 'move';
	private dragging = false;
	private lastDragEnd = 0;
	private readonly gizmos: GizmoManager;
	private readonly disposeSnapping: () => void;
	private wired = new Set<unknown>();

	constructor(
		private scene: Scene,
		private canvas: HTMLCanvasElement,
		private orbit: Camera,
		private options: {
			getSnapPrecision?: () => SnapPrecision;
			getNode(slotId: string): TransformNode | undefined;
			onChanged(slotId: string, center: Vec3, size: Vec3): void;
		}
	) {
		this.gizmos = new GizmoManager(scene);
		this.gizmos.usePointerToAttachGizmos = false;
		this.disposeSnapping = bindTransformSnapping(scene, this.gizmos, undefined, this.options.getSnapPrecision);
	}

	isDragging(): boolean { return this.dragging; }
	recentlyDragged(): boolean { return performance.now() - this.lastDragEnd < 300; }

	/** Shows the box of `slotId` (null: none) at `center` and `size`, with handles in `mode`. A box being dragged is left alone. */
	update(slotId: string | null, center: Vec3, size: Vec3, mode: ColliderGizmoMode): void {
		this.mode = mode;
		const node = slotId ? this.options.getNode(slotId) : undefined;
		if (!slotId || !node) return this.clear();
		if (this.dragging && this.slotId === slotId) return;
		if (this.slotId !== slotId || this.box?.parent !== node) {
			this.clear();
			this.box = new TransformNode(`collider-box-${slotId}`, this.scene);
			this.box.parent = node;
			this.edges = MeshBuilder.CreateLineSystem(`collider-box-edges-${slotId}`, { lines: boxLines().map((line) => line.map((p) => Vector3.FromArray(p))) }, this.scene);
			this.edges.parent = this.box;
			this.edges.color = COLOUR;
			this.edges.layerMask = EDITOR_ONLY;
			this.edges.isPickable = false;
			this.slotId = slotId;
		}
		this.box!.position.copyFromFloats(...center);
		this.box!.scaling.copyFromFloats(...size);
		this.gizmos.positionGizmoEnabled = mode === 'move';
		this.gizmos.rotationGizmoEnabled = false;
		this.gizmos.scaleGizmoEnabled = mode === 'scale';
		this.wire(this.gizmos.gizmos.positionGizmo);
		this.wire(this.gizmos.gizmos.scaleGizmo);
		this.gizmos.attachToNode(this.box);
	}

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
			if (!this.slotId || !this.box) return;
			const size = this.box.scaling.asArray() as Vec3;
			this.options.onChanged(this.slotId, this.box.position.asArray() as Vec3, size.map((value) => Math.max(0.01, Math.abs(value))) as Vec3);
		});
	}

	private clear(): void {
		this.gizmos.attachToNode(null);
		this.edges?.dispose();
		this.box?.dispose();
		this.edges = null;
		this.box = null;
		this.slotId = null;
	}

	dispose(): void {
		this.disposeSnapping();
		this.clear();
		this.gizmos.dispose();
	}
}

/** The box round what an object draws, in the object's own space before its scale: where a custom box starts from. */
export function drawnBox(node: TransformNode): { center: Vec3; size: Vec3 } {
	node.computeWorldMatrix(true);
	const bounds = node.getHierarchyBoundingVectors(true);
	const inverse = node.getWorldMatrix().clone().invert();
	const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
	for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
		const local = Vector3.TransformCoordinates(new Vector3(x, y, z), inverse);
		min.minimizeInPlace(local);
		max.maximizeInPlace(local);
	}
	if (![min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite)) return { center: [0, 0, 0], size: [1, 1, 1] };
	const round = (value: number) => Math.round(value * 1000) / 1000;
	return {
		center: [round((min.x + max.x) / 2), round((min.y + max.y) / 2), round((min.z + max.z) / 2)],
		size: [Math.max(0.01, round(max.x - min.x)), Math.max(0.01, round(max.y - min.y)), Math.max(0.01, round(max.z - min.z))]
	};
}
