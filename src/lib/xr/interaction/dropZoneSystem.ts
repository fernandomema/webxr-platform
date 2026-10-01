import { AbstractMesh, Matrix, Quaternion, Vector3, type TransformNode } from '@babylonjs/core';
import { findComponent } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from './grabSystem';
import { boundsCenter, isInsideZone, settleInZone, type DropAlign, type DroppedObject, type ZoneBox } from './dropZoneMath';
import type { Q4, V3 } from '../avatar/ik';

/**
 * Tidies up an object let go inside a `dropZone`: it turns to sit upright and settles on the zone's floor, as if it had been put
 * down on a table. Only the host (or a solo player) decides; guests see the result in the next state update, like every other
 * authoritative change. It runs after the socket system, and leaves alone anything a socket just took.
 */
export class DropZoneSystem {
	constructor(
		private sceneGraph: SceneGraph,
		grabSystem: GrabSystem,
		private isHost: () => boolean
	) {
		grabSystem.addListener({ onGrab: () => {}, onRelease: (slotId) => this.handleRelease(slotId) });
	}

	private handleRelease(slotId: string): void {
		if (!this.isHost()) return;
		const live = this.sceneGraph.getLive(slotId);
		if (!live || live.system) return;
		const slots = this.sceneGraph.allSlots();
		if (slots.some((entry) => findComponent(entry.slot, 'socket')?.occupantId === slotId)) return;

		// A zone that is part of the object itself (a table's own table top) never catches it.
		const own = new Set(this.sceneGraph.getSubtree(slotId).map((entry) => entry.slot.id));
		const zones = slots.filter((entry) => !own.has(entry.slot.id) && findComponent(entry.slot, 'dropZone'));
		if (zones.length === 0) return;

		const object = this.measure(live.node);
		const middle = boundsCenter(object);
		let best: { box: ZoneBox; options: { align: DropAlign; yawStep: number }; volume: number } | null = null;
		for (const entry of zones) {
			const component = findComponent(entry.slot, 'dropZone')!;
			const box = this.zoneBox(entry.node);
			if (!isInsideZone(box, middle)) continue;
			const volume = box.size[0] * box.size[1] * box.size[2];
			// Zones can overlap; the tightest one is the most specific.
			if (!best || volume < best.volume) best = { box, volume, options: { align: component.align ?? 'upright', yawStep: component.yawStep ?? 0 } };
		}
		if (!best) return;

		const settled = settleInZone(best.box, object, best.options);
		this.place(live.node, slotId, settled.position, settled.rotation);
		// A thrown object would otherwise carry on out of the zone it was just set down in.
		if (findComponent(live.slot, 'velocity')) this.sceneGraph.setComponentField(slotId, 'velocity', 'linear', [0, 0, 0]);
	}

	private zoneBox(node: TransformNode): ZoneBox {
		node.computeWorldMatrix(true);
		const scale = new Vector3();
		const rotation = new Quaternion();
		const position = new Vector3();
		node.getWorldMatrix().decompose(scale, rotation, position);
		return {
			center: position.asArray() as V3,
			rotation: rotation.asArray() as Q4,
			size: [Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)]
		};
	}

	/** The object's pose and the corners of everything it is made of, in its own frame. */
	private measure(node: TransformNode): DroppedObject {
		node.computeWorldMatrix(true);
		const scale = new Vector3();
		const rotation = new Quaternion();
		const position = new Vector3();
		node.getWorldMatrix().decompose(scale, rotation, position);
		const inverse = Quaternion.Inverse(rotation);
		const meshes = [...(node instanceof AbstractMesh ? [node] : []), ...node.getChildMeshes(false)];
		const localCorners: V3[] = [];
		for (const mesh of meshes) {
			if (!mesh.isEnabled() || mesh.getTotalVertices() === 0) continue;
			mesh.computeWorldMatrix(true);
			for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
				const local = new Vector3();
				corner.subtract(position).rotateByQuaternionToRef(inverse, local);
				localCorners.push(local.asArray() as V3);
			}
		}
		return { position: position.asArray() as V3, rotation: rotation.asArray() as Q4, localCorners };
	}

	/** Puts the object at a pose in the world, whatever slot it is under. */
	private place(node: TransformNode, slotId: string, position: V3, rotation: Q4): void {
		const scale = new Vector3();
		node.getWorldMatrix().decompose(scale);
		const world = Matrix.Compose(scale, Quaternion.FromArray(rotation), Vector3.FromArray(position));
		const parent = node.parent as TransformNode | null;
		const local = parent ? world.multiply(Matrix.Invert(parent.getWorldMatrix())) : world;
		const localPosition = new Vector3();
		const localRotation = new Quaternion();
		local.decompose(undefined, localRotation, localPosition);
		this.sceneGraph.placeSlotLocal(slotId, localPosition.asArray() as V3, localRotation.asArray() as Q4);
	}
}
