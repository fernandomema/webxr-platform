import { Vector3, Quaternion, type TransformNode, type Scene } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import { isGrabbable } from '$lib/ecs/types';

interface TwoPointState {
	initialDistance: number;
	initialScale: Vector3;
	initialDirection: Vector3;
	initialRotation: Quaternion;
	initialMidpoint: Vector3;
	initialPosition: Vector3;
}

/**
 * Generic grab behaviour shared by every `grabbable` Slot, including UI
 * panels: a single grabber (hand or laser) rigidly follows the grabber node
 * (via Babylon's own transform parenting — no manual offset math needed);
 * a second simultaneous grabber on the same slot switches to two-point mode
 * (move by midpoint, scale by distance ratio, rotate by direction delta) if
 * the slot's `grabbable.scalable` flag allows it.
 */
export class GrabSystem {
	private grabberOf = new Map<string, string>(); // grabberId -> slotId
	private grabbersOfSlot = new Map<string, Map<string, TransformNode>>(); // slotId -> grabberId -> node
	private twoPoint = new Map<string, TwoPointState>();
	private originalParent = new Map<string, TransformNode | null>();

	constructor(
		scene: Scene,
		private sceneGraph: SceneGraph
	) {
		scene.onBeforeRenderObservable.add(() => this.update());
	}

	getGrabbersForSlot(slotId: string): string[] {
		return [...(this.grabbersOfSlot.get(slotId)?.keys() ?? [])];
	}

	isHolding(grabberId: string): boolean {
		return this.grabberOf.has(grabberId);
	}

	getHeldSlot(grabberId: string): string | null {
		return this.grabberOf.get(grabberId) ?? null;
	}

	/** Grab priority: caller decides target (laser hit takes priority over hand overlap). */
	grab(grabberId: string, grabberNode: TransformNode, targetSlotId: string | null): void {
		if (!targetSlotId || this.grabberOf.has(grabberId)) return;

		const live = this.sceneGraph.getLive(targetSlotId);
		const grabbable = live && isGrabbable(live.slot);
		if (!live || !grabbable) return;

		let grabbers = this.grabbersOfSlot.get(targetSlotId);
		if (grabbers && (grabbers.size >= 2 || !grabbable.scalable)) return;
		if (!grabbers) {
			this.originalParent.set(targetSlotId, live.node.parent as TransformNode | null);
		}
		if (!grabbers) {
			grabbers = new Map();
			this.grabbersOfSlot.set(targetSlotId, grabbers);
		}
		grabbers.set(grabberId, grabberNode);
		this.grabberOf.set(grabberId, targetSlotId);

		if (grabbers.size === 1) {
			live.node.setParent(grabberNode);
		} else if (grabbers.size === 2 && grabbable.scalable) {
			live.node.setParent(null);
			this.beginTwoPoint(targetSlotId, [...grabbers.values()]);
		}
		// a 3rd simultaneous grabber, or a non-scalable slot's 2nd grabber, is ignored
	}

	release(grabberId: string): void {
		const slotId = this.grabberOf.get(grabberId);
		if (!slotId) return;

		const grabbers = this.grabbersOfSlot.get(slotId);
		const wasTwoPoint = (grabbers?.size ?? 0) >= 2;

		// Letting go of either hand during a two-point (scale/rotate) hold drops
		// the object entirely, rather than silently continuing single-handed —
		// the other hand would otherwise stay "grabbing" until ITS trigger is
		// released too, blocking it from grabbing anything else in the meantime
		// with no visible sign why.
		if (wasTwoPoint && grabbers) {
			for (const otherId of grabbers.keys()) this.grabberOf.delete(otherId);
			grabbers.clear();
		} else {
			this.grabberOf.delete(grabberId);
			grabbers?.delete(grabberId);
		}
		this.twoPoint.delete(slotId);

		const live = this.sceneGraph.getLive(slotId);
		if (!live) {
			this.grabbersOfSlot.delete(slotId);
			this.originalParent.delete(slotId);
			return;
		}

		live.node.setParent(this.originalParent.get(slotId) ?? null);
		this.grabbersOfSlot.delete(slotId);
		this.originalParent.delete(slotId);
	}

	/** Release every grabber holding anything (e.g. controller disconnected). */
	releaseAllFor(grabberId: string): void {
		this.release(grabberId);
	}

	private beginTwoPoint(slotId: string, nodes: TransformNode[]): void {
		const live = this.sceneGraph.getLive(slotId);
		if (!live) return;
		const [a, b] = nodes;
		const posA = a.absolutePosition;
		const posB = b.absolutePosition;
		const dir = posB.subtract(posA);
		const length = dir.length();

		// Deltas from these initial values drive the update loop below — NOT the
		// grabbers' raw positions — so an object grabbed at a distance (via
		// laser) keeps that distance instead of snapping to sit between the
		// two hands.
		this.twoPoint.set(slotId, {
			initialDistance: length > 0.0001 ? length : 0.0001,
			initialScale: live.node.scaling.clone(),
			initialDirection: dir.normalizeToNew(),
			initialRotation: live.node.rotationQuaternion?.clone() ?? Quaternion.Identity(),
			initialMidpoint: Vector3.Center(posA, posB),
			initialPosition: live.node.position.clone()
		});
	}

	private update(): void {
		for (const [slotId, state] of this.twoPoint) {
			const grabbers = this.grabbersOfSlot.get(slotId);
			const live = this.sceneGraph.getLive(slotId);
			if (!grabbers || grabbers.size !== 2 || !live) continue;

			const [a, b] = [...grabbers.values()];
			const posA = a.absolutePosition;
			const posB = b.absolutePosition;
			const dir = posB.subtract(posA);
			const distance = Math.max(dir.length(), 0.0001);
			const midpointDelta = Vector3.Center(posA, posB).subtract(state.initialMidpoint);

			live.node.position = state.initialPosition.add(midpointDelta);
			live.node.scaling = state.initialScale.scale(distance / state.initialDistance);

			const rotationDelta = Quaternion.FromUnitVectorsToRef(
				state.initialDirection,
				dir.normalizeToNew(),
				new Quaternion()
			);
			live.node.rotationQuaternion = rotationDelta.multiply(state.initialRotation);
		}
	}
}
