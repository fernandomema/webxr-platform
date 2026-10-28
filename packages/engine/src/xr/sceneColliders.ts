import { Matrix, Vector3, type AbstractMesh, type Mesh, type TransformNode } from '@babylonjs/core';
import { isBuiltinMesh } from '../assets/ref.ts';
import { isGrabbable, type Slot } from '../ecs/types.ts';
import { axesOf, box, cylinder, normalize, sphere, type Shape, type V3 } from '../physics/shapes.ts';
import { CollisionWorld } from '../physics/world.ts';

/** What the world's colliders are made from: the slots and their nodes, narrowly, so that a test can stand in for the scene graph. */
export interface ColliderSource {
	allSlots(): { slot: Slot; node: TransformNode; system?: boolean; fragment?: string; model?: { instance?: { root: { getChildMeshes(directDescendantsOnly?: boolean): AbstractMesh[] } } } }[];
	onChanged(listener: (ids: readonly string[] | null) => void): () => void;
}

interface Tracked {
	slotId: string;
	/** What is measured: the slot's own mesh, or for a model the invisible box that stands for it. */
	node: TransformNode;
	slot: Slot;
	/** Meshes of a model whose collider is its geometry: its box is the box around them. */
	meshes?: AbstractMesh[];
	flag: number;
	enabled: boolean;
}

/** The thinnest a flat collider (a floor, a plane) is made: a body cannot be told it is on something with no thickness. */
const MIN_HALF = 0.01;

/** Whether a slot is a solid for bodies and for scripts: a collider, or a floor (a ground or a disc), on something drawn, that is not an object to pick up. */
export function isColliderSlot(slot: Slot): boolean {
	const drawn = slot.components.find((c) => c.type === 'meshRenderer');
	if (!drawn || drawn.type !== 'meshRenderer' || isGrabbable(slot)) return false;
	return slot.components.some((c) => c.type === 'collider') || isBuiltinMesh(drawn.meshRef, 'ground') || isBuiltinMesh(drawn.meshRef, 'disc');
}

/**
 * The solids of the scene as a `CollisionWorld`: every `collider` slot, as the shape it is drawn as (boxes and planes as oriented boxes,
 * spheres, cylinders and discs as such, models as the box around them), kept where the slot is now. A slot that moves (a pooled block
 * laid out by a script) is found where it went the next time the world is asked, without anyone announcing it.
 */
export class SceneColliders {
	readonly world = new CollisionWorld();
	private tracked = new Map<string, Tracked>();
	private dirty = true;
	private stop: () => void;

	constructor(private readonly source: ColliderSource) {
		this.stop = source.onChanged(() => { this.dirty = true; });
	}

	dispose(): void {
		this.stop();
		this.world.clear();
		this.tracked.clear();
	}

	/** Makes the world match the scene: new colliders in, gone ones out, moved ones where they are. Cheap when nothing changed. */
	sync(): CollisionWorld {
		if (this.dirty) this.rebuild();
		for (const entry of this.tracked.values()) this.update(entry);
		return this.world;
	}

	/** The id of the slot a collider id stands for (they are the same: a collider is named after its slot). */
	slotOf(id: string): Slot | undefined {
		return this.tracked.get(id)?.slot;
	}

	/** Forgets what was known: the next query rebuilds. */
	invalidate(): void {
		this.dirty = true;
	}

	private rebuild(): void {
		this.dirty = false;
		const seen = new Set<string>();
		const all = this.source.allSlots();
		const byId = new Map(all.map((live) => [live.slot.id, live.slot]));
		/** Parts of something you can pick up travel with it and are no more a wall than the thing is. */
		const insideGrabbable = (slot: Slot): boolean => {
			for (let parent = slot.parentId ? byId.get(slot.parentId) : undefined, guard = 0; parent && guard < 64; parent = parent.parentId ? byId.get(parent.parentId) : undefined, guard++) if (isGrabbable(parent)) return true;
			return false;
		};
		for (const live of all) {
			if ((live.system && !live.fragment) || !isColliderSlot(live.slot) || insideGrabbable(live.slot)) continue;
			seen.add(live.slot.id);
			const existing = this.tracked.get(live.slot.id);
			if (existing && existing.slot === live.slot && existing.node === (((live.node.metadata as { selectionMesh?: TransformNode } | null)?.selectionMesh ?? live.node) as TransformNode)) continue;
			const modelMeshes = live.slot.components.some((c) => c.type === 'collider' && c.shape === 'mesh') ? live.model?.instance?.root.getChildMeshes(false) : undefined;
			this.tracked.set(live.slot.id, { slotId: live.slot.id, node: ((live.node.metadata as { selectionMesh?: TransformNode } | null)?.selectionMesh ?? live.node) as TransformNode, slot: live.slot, meshes: modelMeshes, flag: -1, enabled: false });
		}
		for (const id of [...this.tracked.keys()]) {
			if (seen.has(id)) continue;
			this.tracked.delete(id);
			this.world.remove(id);
		}
	}

	private update(entry: Tracked): void {
		const enabled = entry.node.isEnabled(false);
		if (!enabled) {
			if (entry.enabled) { this.world.remove(entry.slotId); entry.enabled = false; entry.flag = -1; }
			return;
		}
		const matrix = entry.node.computeWorldMatrix();
		const flag = (matrix as Matrix & { updateFlag?: number }).updateFlag ?? 0;
		if (entry.enabled && entry.flag === flag && !entry.meshes) return;
		const shape = shapeOf(entry);
		entry.flag = flag;
		if (!shape) { this.world.remove(entry.slotId); entry.enabled = false; return; }
		this.world.set(entry.slotId, shape);
		entry.enabled = true;
	}
}

/** The shape a tracked slot is solid as, in the world now; null when it cannot be told. */
function shapeOf(entry: Tracked): Shape | null {
	const { node, slot } = entry;
	const renderer = slot.components.find((c) => c.type === 'meshRenderer');
	if (entry.meshes && entry.meshes.length > 0) return modelBox(entry.meshes);
	const mesh = node as Mesh;
	if (typeof mesh.getBoundingInfo !== 'function') return null;
	const bounds = mesh.getBoundingInfo().boundingBox;
	const world = node.getWorldMatrix();
	const m = world.m;
	const column = (c: number): V3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
	const lengths: V3 = [Math.hypot(...column(0)), Math.hypot(...column(1)), Math.hypot(...column(2))];
	if (lengths.some((l) => l < 1e-9)) return null;
	const axes: [V3, V3, V3] = [normalize(column(0)), normalize(column(1)), normalize(column(2))];
	const lc = bounds.center, le = bounds.extendSize;
	const center = Vector3.TransformCoordinates(new Vector3(lc.x, lc.y, lc.z), world).asArray() as V3;
	// The local half size times the scale, along the node's own axes (already scaled in `world`'s columns).
	const half: V3 = [Math.max(le.x * lengths[0], MIN_HALF), Math.max(le.y * lengths[1], MIN_HALF), Math.max(le.z * lengths[2], MIN_HALF)];
	const id = renderer && renderer.type === 'meshRenderer' && renderer.meshRef.kind === 'builtin' ? renderer.meshRef.id : null;
	if (renderer && renderer.type === 'meshRenderer' && id === 'sphere' && isBuiltinMesh(renderer.meshRef, 'sphere')) return sphere(center, Math.max(half[0], half[1], half[2]));
	if (id === 'cylinder') return cylinder(center, Math.max(half[0], half[2]), half[1], quatOf(axes));
	if (id === 'disc') {
		// A flat circle: its thin direction is the cylinder's axis.
		const thin = half[0] <= half[1] && half[0] <= half[2] ? 0 : half[1] <= half[2] ? 1 : 2;
		const others = [0, 1, 2].filter((k) => k !== thin);
		return { kind: 'cylinder', center, axis: axes[thin], radius: Math.max(half[others[0]], half[others[1]]), halfLength: half[thin] };
	}
	return { kind: 'box', center, half, axes };
}

/** The box around a set of meshes (a model's geometry), axis-aligned in the world. */
function modelBox(meshes: AbstractMesh[]): Shape | null {
	const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
	let any = false;
	for (const mesh of meshes) {
		if (typeof mesh.getBoundingInfo !== 'function' || !mesh.isEnabled(false)) continue;
		mesh.computeWorldMatrix();
		const b = mesh.getBoundingInfo().boundingBox;
		min.minimizeInPlace(b.minimumWorld);
		max.maximizeInPlace(b.maximumWorld);
		any = true;
	}
	if (!any) return null;
	const half: V3 = [Math.max((max.x - min.x) / 2, MIN_HALF), Math.max((max.y - min.y) / 2, MIN_HALF), Math.max((max.z - min.z) / 2, MIN_HALF)];
	return box([(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2], half);
}

/** A quaternion for orthonormal axes (a rotation matrix's columns), for the helpers that take one. */
function quatOf(axes: [V3, V3, V3]): [number, number, number, number] {
	const [x, y, z] = axes;
	const trace = x[0] + y[1] + z[2];
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
	}
	if (x[0] > y[1] && x[0] > z[2]) {
		const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
		return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
	}
	if (y[1] > z[2]) {
		const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
		return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
	}
	const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
	return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}

export { axesOf };
