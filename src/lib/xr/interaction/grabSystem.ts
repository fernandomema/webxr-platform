import { Vector3, Quaternion, type TransformNode, type Scene } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import { isGrabbable } from '$lib/ecs/types';

interface TwoPointState {
	nodes: readonly [TransformNode, TransformNode];
	initialDistance: number;
	initialScale: Vector3;
	initialDirection: Vector3;
	initialRotation: Quaternion;
	initialMidpoint: Vector3;
	initialPosition: Vector3;
}

/** Lets another system veto a grab (e.g. an object equipped in someone's hand, or a hand that is already occupied). */
export interface GrabGuard {
	canGrab(slotId: string, grabberId: string): boolean;
}

/** Lets another system react to a grab starting or ending, once the grab itself is done. */
export interface GrabListener {
	onGrab(slotId: string): void;
	onRelease(slotId: string): void;
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
	private guard: GrabGuard | null = null;
	private listeners: GrabListener[] = [];
	private direction = Vector3.Zero();
	private midpointDelta = Vector3.Zero();
	private rotationDelta = Quaternion.Identity();

	constructor(
		scene: Scene,
		private sceneGraph: SceneGraph
	) {
		scene.onBeforeRenderObservable.add(() => this.update());
	}

	setGuard(guard: GrabGuard): void {
		this.guard = guard;
	}

	/** Listeners run in the order they were added: one that takes the object over (a socket) goes before one that only tidies it up. */
	addListener(listener: GrabListener): void {
		this.listeners.push(listener);
	}

	/** Where a slot goes when let go, if not where it was when grabbed (for example, taken out of a socket). */
	overrideReleaseParent(slotId: string, parent: TransformNode | null): void {
		if (this.originalParent.has(slotId)) this.originalParent.set(slotId, parent);
	}

	/**
	 * Forgets a single-handed grab WITHOUT re-parenting the object or firing
	 * `onRelease`, so another system (equipment) can take the object over
	 * seamlessly. Returns the slot that was held, or null if there was nothing
	 * to hand over (nothing held, or a two-handed hold).
	 */
	detach(grabberId: string): string | null {
		const slotId = this.grabberOf.get(grabberId);
		if (!slotId || (this.grabbersOfSlot.get(slotId)?.size ?? 0) !== 1) return null;
		this.grabberOf.delete(grabberId);
		this.grabbersOfSlot.delete(slotId);
		this.originalParent.delete(slotId);
		this.twoPoint.delete(slotId);
		return slotId;
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

		const effectiveTargetId = this.sceneGraph.resolveGrabTarget(targetSlotId);
		if (!effectiveTargetId) return;
		const live = this.sceneGraph.getLive(effectiveTargetId);
		const grabbable = live && isGrabbable(live.slot);
		if (!live || !grabbable) return;
		if (this.guard && !this.guard.canGrab(effectiveTargetId, grabberId)) return;

		let grabbers = this.grabbersOfSlot.get(effectiveTargetId);
		if (grabbers && (grabbers.size >= 2 || !grabbable.scalable)) return;
		if (!grabbers) {
			this.originalParent.set(effectiveTargetId, live.node.parent as TransformNode | null);
		}
		if (!grabbers) {
			grabbers = new Map();
			this.grabbersOfSlot.set(effectiveTargetId, grabbers);
		}
		grabbers.set(grabberId, grabberNode);
		this.grabberOf.set(grabberId, effectiveTargetId);

		if (grabbers.size === 1) {
			live.node.setParent(grabberNode);
		} else if (grabbers.size === 2 && grabbable.scalable) {
			live.node.setParent(null);
			this.beginTwoPoint(effectiveTargetId, [...grabbers.values()]);
		}
		// a 3rd simultaneous grabber, or a non-scalable slot's 2nd grabber, is ignored

		if (grabbers.size === 1) {
			try {
				this.sceneGraph.getLive(effectiveTargetId)?.runtime?.onGrab?.();
			} catch (err) {
				console.error(`[grabSystem] onGrab threw for ${effectiveTargetId}`, err);
			}
			for (const listener of this.listeners) listener.onGrab(effectiveTargetId);
		}
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

		// Fires exactly once per release() call — even the two-point "drop both
		// hands at once" path above only ever reaches here a single time.
		try {
			live.runtime?.onRelease?.();
		} catch (err) {
			console.error(`[grabSystem] onRelease threw for ${slotId}`, err);
		}
		for (const listener of this.listeners) listener.onRelease(slotId);
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
			nodes: [a, b],
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

			const [a, b] = state.nodes;
			const posA = a.absolutePosition;
			const posB = b.absolutePosition;
			posB.subtractToRef(posA, this.direction);
			const distance = Math.max(this.direction.length(), 0.0001);
			Vector3.CenterToRef(posA, posB, this.midpointDelta);
			this.midpointDelta.subtractInPlace(state.initialMidpoint);

			state.initialPosition.addToRef(this.midpointDelta, live.node.position);
			state.initialScale.scaleToRef(distance / state.initialDistance, live.node.scaling);

			Quaternion.FromUnitVectorsToRef(
				state.initialDirection,
				this.direction.normalize(),
				this.rotationDelta
			);
			live.node.rotationQuaternion ??= Quaternion.Identity();
			this.rotationDelta.multiplyToRef(state.initialRotation, live.node.rotationQuaternion);
		}
	}
}
