import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	Vector3,
	Quaternion,
	TransformNode,
	type Scene,
	type AbstractMesh
} from '@babylonjs/core';
import type { Slot, SlotTree } from '$lib/ecs/types';
import { findComponent } from '$lib/ecs/types';

interface LiveSlot {
	slot: Slot;
	node: TransformNode;
	/** System nodes (e.g. the Dash/Inspector panels) are grabbable like any Slot but excluded from serialize(). */
	system?: boolean;
}

/**
 * Runtime instantiation of a SlotTree into real Babylon nodes/meshes, kept in
 * sync via Slot.id <-> node.metadata.slotId. Can serialize its current live
 * state back into a SlotTree (positions/rotations/scales reflect grabs/edits) —
 * used for saving to inventory, saving a world template, and host->guest sync.
 */
export class SceneGraph {
	private live = new Map<string, LiveSlot>();

	constructor(private scene: Scene) {}

	load(tree: SlotTree): void {
		for (const slot of tree) this.spawnNode(slot);
		for (const slot of tree) {
			if (!slot.parentId) continue;
			const parent = this.live.get(slot.parentId)?.node;
			const self = this.live.get(slot.id)?.node;
			if (parent && self) self.parent = parent;
		}
	}

	addSlot(slot: Slot, options?: { system?: boolean }): TransformNode {
		const node = this.spawnNode(slot);
		if (options?.system) {
			const entry = this.live.get(slot.id);
			if (entry) entry.system = true;
		}
		if (slot.parentId) {
			const parent = this.live.get(slot.parentId)?.node;
			if (parent) node.parent = parent;
		}
		return node;
	}

	removeSlot(slotId: string): void {
		const idsToRemove = [...this.live.entries()]
			.filter(([id, entry]) => id === slotId || this.isDescendantOf(entry.slot, slotId))
			.map(([id]) => id);
		for (const id of idsToRemove) {
			const entry = this.live.get(id);
			if (!entry) continue;
			entry.node.dispose();
			this.live.delete(id);
		}
	}

	getLive(slotId: string): LiveSlot | undefined {
		return this.live.get(slotId);
	}

	getSlotIdForNode(node: AbstractMesh | TransformNode | null | undefined): string | null {
		if (!node) return null;
		return (node.metadata?.slotId as string | undefined) ?? null;
	}

	allSlots(): LiveSlot[] {
		return [...this.live.values()];
	}

	/** Current world state as a fresh SlotTree (ids/parentId unchanged, transforms live). System nodes (UI panels) are excluded. */
	serialize(): SlotTree {
		return [...this.live.values()]
			.filter((entry) => !entry.system)
			.map(({ slot, node }) => {
				// A grabbed node is temporarily parented to a hand. Serialize it in
				// its Slot parent space so remote peers receive the same world pose,
				// without breaking the live grab relationship.
				const expectedParent = slot.parentId ? this.live.get(slot.parentId)?.node ?? null : null;
				const transientParent = node.parent;
				if (transientParent !== expectedParent) node.setParent(expectedParent);
				const serialized = {
					...slot,
					position: node.position.asArray() as Slot['position'],
					rotation: (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Slot['rotation'],
					scale: node.scaling.asArray() as Slot['scale']
				};
				if (transientParent !== expectedParent) node.setParent(transientParent);
				return serialized;
			});
	}

	/**
	 * Reconciles the live scene to match `tree` (a host-broadcast snapshot):
	 * adds slots that are new, removes slots that disappeared, and updates
	 * the transform of existing ones — except any id in `ignoreSlotIds`
	 * (typically whatever this client is itself actively grabbing, so a
	 * locally-optimistic grab isn't fought by a slightly-stale broadcast).
	 */
	reconcile(tree: SlotTree, ignoreSlotIds: Set<string> = new Set()): void {
		const incomingIds = new Set(tree.map((s) => s.id));

		for (const id of [...this.live.keys()]) {
			if (!incomingIds.has(id) && !this.live.get(id)?.system) this.removeSlot(id);
		}

		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const existing = this.live.get(slot.id);
			if (!existing) {
				this.addSlot(slot);
				continue;
			}
			existing.slot = slot;
			existing.node.position = Vector3.FromArray(slot.position);
			existing.node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
			existing.node.scaling = Vector3.FromArray(slot.scale);
		}

		// Apply hierarchy after every slot exists so incoming local transforms are
		// interpreted against the correct parent.
		for (const slot of tree) {
			if (ignoreSlotIds.has(slot.id)) continue;
			const node = this.live.get(slot.id)?.node;
			if (!node) continue;
			node.parent = slot.parentId ? this.live.get(slot.parentId)?.node ?? null : null;
		}
	}

	private isDescendantOf(slot: Slot, ancestorId: string): boolean {
		let parentId = slot.parentId;
		while (parentId) {
			if (parentId === ancestorId) return true;
			parentId = this.live.get(parentId)?.slot.parentId ?? null;
		}
		return false;
	}

	private spawnNode(slot: Slot): TransformNode {
		const mesh = findComponent(slot, 'meshRenderer');
		const node: TransformNode = mesh
			? this.createMesh(slot.id, mesh.meshRef, mesh.color)
			: new TransformNode(slot.id, this.scene);

		node.position = Vector3.FromArray(slot.position);
		node.rotationQuaternion = Quaternion.FromArray(slot.rotation);
		node.scaling = Vector3.FromArray(slot.scale);
		node.metadata = { ...(node.metadata ?? {}), slotId: slot.id };

		this.live.set(slot.id, { slot, node });
		return node;
	}

	private createMesh(id: string, ref: string, color?: string): AbstractMesh {
		let mesh: AbstractMesh;
		switch (ref) {
			case 'ground':
				mesh = MeshBuilder.CreateGround(id, { width: 20, height: 20 }, this.scene);
				break;
			case 'sphere':
				mesh = MeshBuilder.CreateSphere(id, { diameter: 1 }, this.scene);
				break;
			case 'plane':
				mesh = MeshBuilder.CreatePlane(id, { size: 1 }, this.scene);
				break;
			case 'box':
			default:
				mesh = MeshBuilder.CreateBox(id, { size: 1 }, this.scene);
				break;
		}
		if (color) {
			const mat = new StandardMaterial(`${id}-mat`, this.scene);
			mat.diffuseColor = Color3.FromHexString(color);
			mesh.material = mat;
		}
		return mesh;
	}
}
