import { Matrix, Vector3, VertexBuffer, type AbstractMesh, type Mesh, type TransformNode } from '@babylonjs/core';
import { isBuiltinMesh } from '../assets/ref.ts';
import { isGrabbable, type Slot } from '../ecs/types.ts';
import { axesOf, box, cylinder, normalize, sphere, type Shape, type V3 } from '../physics/shapes.ts';
import { buildTriMesh } from '../physics/triMesh.ts';
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
	/** The slot's own node, whose space a collider's own box is given in. */
	owner: TransformNode;
	slot: Slot;
	/** A collider of shape `mesh`: solid as the triangles of what is drawn. Which meshes those are is asked again each time, as a model arrives after its slot. */
	triangles?: () => AbstractMesh[];
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
			const wantsTriangles = live.slot.components.some((c) => c.type === 'collider' && c.shape === 'mesh');
			const triangles = wantsTriangles ? () => live.model?.instance?.root.getChildMeshes(false) ?? ((live.node as Mesh).getTotalVertices?.() > 0 ? [live.node as Mesh] : []) : undefined;
			this.tracked.set(live.slot.id, { slotId: live.slot.id, owner: live.node, node: ((live.node.metadata as { selectionMesh?: TransformNode } | null)?.selectionMesh ?? live.node) as TransformNode, slot: live.slot, triangles, flag: -1, enabled: false });
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
		let flag = (matrix as Matrix & { updateFlag?: number }).updateFlag ?? 0;
		let meshes: AbstractMesh[] | undefined;
		if (entry.triangles) {
			// Triangles are made again when the slot moves or when what it is drawn with changes (a model that has just loaded).
			meshes = entry.triangles();
			flag = flag * 4096 + meshes.length;
		}
		if (entry.enabled && entry.flag === flag) return;
		const shape = meshes ? meshShape(meshes) : shapeOf(entry);
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
	const custom = customBox(entry.owner, slot);
	if (custom) return custom;
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

/** The box a `collider` sets for itself (`center` and `size`, in the node's space before its scale), in the world; null when it sets none. */
function customBox(node: TransformNode, slot: Slot): Shape | null {
	const collider = slot.components.find((c) => c.type === 'collider');
	if (!collider || collider.type !== 'collider' || collider.shape !== 'box' || !collider.size) return null;
	const { size, center = [0, 0, 0] } = collider;
	if (![...size, ...center].every(Number.isFinite)) return null;
	const world = node.getWorldMatrix();
	const m = world.m;
	const column = (c: number): V3 => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
	const lengths: V3 = [Math.hypot(...column(0)), Math.hypot(...column(1)), Math.hypot(...column(2))];
	if (lengths.some((l) => l < 1e-9)) return null;
	const axes: [V3, V3, V3] = [normalize(column(0)), normalize(column(1)), normalize(column(2))];
	const at = Vector3.TransformCoordinates(new Vector3(center[0], center[1], center[2]), world).asArray() as V3;
	const half: V3 = [Math.max(Math.abs(size[0]) / 2 * lengths[0], MIN_HALF), Math.max(Math.abs(size[1]) / 2 * lengths[1], MIN_HALF), Math.max(Math.abs(size[2]) / 2 * lengths[2], MIN_HALF)];
	return { kind: 'box', center: at, half, axes };
}

/** The triangles of a set of meshes, in the world; null when there are none (a model that has not arrived). */
function meshShape(meshes: AbstractMesh[]): Shape | null {
	const parts: { positions: Float32Array; indices: ArrayLike<number>; m: ArrayLike<number> }[] = [];
	let vertices = 0, indexCount = 0;
	for (const mesh of meshes) {
		if (typeof mesh.getVerticesData !== 'function' || !mesh.isEnabled(false)) continue;
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		if (!positions || positions.length < 9) continue;
		const own = mesh.getIndices();
		const indices = own && own.length >= 3 ? own : Array.from({ length: Math.floor(positions.length / 9) * 3 }, (_, i) => i);
		mesh.computeWorldMatrix(true);
		parts.push({ positions: positions instanceof Float32Array ? positions : Float32Array.from(positions), indices, m: mesh.getWorldMatrix().m });
		vertices += positions.length / 3;
		indexCount += indices.length;
	}
	if (indexCount === 0) return null;
	const world = new Float32Array(vertices * 3);
	const index = new Uint32Array(indexCount);
	let v = 0, i = 0;
	for (const { positions, indices, m } of parts) {
		for (let k = 0; k < positions.length; k += 3) {
			const x = positions[k], y = positions[k + 1], z = positions[k + 2];
			world[(v + k / 3) * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
			world[(v + k / 3) * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
			world[(v + k / 3) * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
		}
		for (let k = 0; k < indices.length; k++) index[i + k] = indices[k] + v;
		v += positions.length / 3;
		i += indices.length;
	}
	return buildTriMesh(world, index);
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
