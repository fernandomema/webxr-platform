import {
	Color3,
	GizmoManager,
	MeshBuilder,
	Quaternion,
	TransformNode,
	Vector3,
	type Camera,
	type LinesMesh,
	type Scene
} from '@babylonjs/core';
import { boxLines, floorCross, type Polyline } from './dropZoneGeometry';
import { EDITOR_ONLY } from './previewCameraHelper';

/**
 * How the Studio shows and edits a "Drop zone" slot: its box drawn in the viewport (with a cross on the floor things rest on),
 * and move, rotate and scale handles on the selected one, the way an engine editor handles a box collider. The box is the
 * slot's own unit cube, so the handles simply change the slot's transform; they write it back through `onChanged`.
 */

const SELECTED = Color3.FromHexString('#34d399');
const OTHER = Color3.FromHexString('#64748b');
/** How close, in metres, a click has to be to an edge to pick the box. */
const PICK_THRESHOLD = 0.06;

export type ZoneGizmoMode = 'move' | 'rotate' | 'scale';

interface Entry {
	root: TransformNode;
	edges: LinesMesh;
	floor: LinesMesh;
}

export class DropZoneHelper {
	private entries = new Map<string, Entry>();
	private selectedId: string | null = null;
	private mode: ZoneGizmoMode = 'move';
	private lastDragEnd = 0;
	private dragging = false;
	private readonly gizmos: GizmoManager;
	private readonly observer;
	private wired = new Set<unknown>();

	constructor(
		private scene: Scene,
		private canvas: HTMLCanvasElement,
		private orbit: Camera,
		private options: {
			getNode(slotId: string): TransformNode | undefined;
			onChanged(slotId: string, position: [number, number, number], rotation: [number, number, number, number], scale: [number, number, number]): void;
		}
	) {
		this.gizmos = new GizmoManager(scene);
		this.gizmos.usePointerToAttachGizmos = false;
		this.observer = scene.onBeforeRenderObservable.add(() => this.frame());
	}

	setMode(mode: ZoneGizmoMode): void {
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

	update(zoneIds: readonly string[], selectedId: string | null): void {
		const wanted = new Set(zoneIds);
		for (const [id, entry] of this.entries) {
			if (!wanted.has(id)) {
				this.disposeEntry(entry);
				this.entries.delete(id);
			}
		}
		for (const id of zoneIds) {
			const entry = this.entries.get(id) ?? this.create(id);
			const colour = id === selectedId ? SELECTED : OTHER;
			entry.edges.color = colour;
			entry.floor.color = colour;
		}
		this.selectedId = selectedId && this.entries.has(selectedId) ? selectedId : null;
		this.applySelection();
	}

	private lines(name: string, polylines: Polyline[], parent: TransformNode): LinesMesh {
		const mesh = MeshBuilder.CreateLineSystem(name, { lines: polylines.map((line) => line.map((p) => Vector3.FromArray(p))) }, this.scene);
		mesh.parent = parent;
		mesh.layerMask = EDITOR_ONLY;
		mesh.isPickable = false;
		return mesh;
	}

	private create(id: string): Entry {
		const root = new TransformNode(`drop-zone-${id}`, this.scene);
		const edges = this.lines(`drop-zone-edges-${id}`, boxLines(), root);
		// Clicking an edge selects the zone. Only the edges can be picked, so a zone round a table does not hide the table.
		edges.isPickable = true;
		edges.intersectionThreshold = PICK_THRESHOLD;
		edges.metadata = { slotId: id };
		const floor = this.lines(`drop-zone-floor-${id}`, floorCross(), root);
		const entry: Entry = { root, edges, floor };
		this.entries.set(id, entry);
		return entry;
	}

	private disposeEntry(entry: Entry): void {
		entry.edges.dispose();
		entry.floor.dispose();
		entry.root.dispose();
	}

	/** Handles belong to the selected zone only. */
	private applySelection(): void {
		const id = this.selectedId;
		const node = id ? this.options.getNode(id) : undefined;
		this.gizmos.positionGizmoEnabled = Boolean(node) && this.mode === 'move';
		this.gizmos.rotationGizmoEnabled = Boolean(node) && this.mode === 'rotate';
		this.gizmos.scaleGizmoEnabled = Boolean(node) && this.mode === 'scale';
		this.wire(this.gizmos.gizmos.positionGizmo);
		this.wire(this.gizmos.gizmos.rotationGizmo);
		this.wire(this.gizmos.gizmos.scaleGizmo);
		this.gizmos.attachToNode(node ?? null);
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
			if (!id || !node) return;
			this.options.onChanged(
				id,
				node.position.asArray() as [number, number, number],
				(node.rotationQuaternion ?? Quaternion.Identity()).asArray() as [number, number, number, number],
				node.scaling.asArray() as [number, number, number]
			);
		});
	}

	/** Keeps every drawn box on its slot, including the slot's scale: that is what makes the unit cube the zone's size. */
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
			entry.root.scaling.copyFrom(scale);
		}
	}

	dispose(): void {
		this.scene.onBeforeRenderObservable.remove(this.observer);
		this.gizmos.dispose();
		for (const entry of this.entries.values()) this.disposeEntry(entry);
		this.entries.clear();
	}
}
