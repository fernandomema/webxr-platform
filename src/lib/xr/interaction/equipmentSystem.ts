import { Observable, Quaternion, Vector3, type Scene, type TransformNode } from '@babylonjs/core';
import { isEquippable } from '$lib/ecs/types';
import { eulerToQuat } from '$lib/math/euler';
import type { EquipQuery, SceneGraph } from '../sceneGraph';
import type { HandEvent, TriggerEvent } from '../codeBlockRuntime';
import { EquipmentRegistry, type EquipHand, type EquipmentEntry } from './equipmentRegistry';
import type { GrabGuard, GrabSystem } from './grabSystem';

export interface EquipmentChange {
	playerId: string;
	hand: EquipHand;
	/** The object now in the hand, or null when the hand was emptied. */
	slotId: string | null;
	/** What was in the hand before, if anything. */
	previousSlotId: string | null;
}

export type TriggerOutcome = 'none' | 'consumed' | 'passed';

/**
 * Objects held in a hand until explicitly unequipped. This is separate from
 * GrabSystem on purpose: letting go of the grip ends a grab but not an
 * equip. The association is session state — the slot's serialized `parentId`
 * never changes, so an equipped object can still be saved or cloned with its
 * children.
 *
 * Hands are identified by (playerId, hand). GrabSystem's own ids are
 * 'left'/'right' for the local player and '<guestId>:<hand>' for guests on
 * the host; `grabberIdFor` converts.
 */
export class EquipmentSystem implements GrabGuard, EquipQuery {
	readonly registry = new EquipmentRegistry();
	readonly onChanged = new Observable<EquipmentChange>();
	private handNodes = new Map<string, TransformNode>(); // slotId -> the hand node it follows

	constructor(
		scene: Scene,
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private localPlayerId: () => string,
		private playerName: (playerId: string) => string
	) {
		grabSystem.setGuard(this);
		sceneGraph.setEquipQuery(this);
		scene.onBeforeRenderObservable.add(() => this.update());
	}

	grabberIdFor(playerId: string, hand: EquipHand): string {
		return playerId === this.localPlayerId() ? hand : `${playerId}:${hand}`;
	}

	private parseGrabberId(grabberId: string): { playerId: string; hand: EquipHand } | null {
		const colon = grabberId.indexOf(':');
		const hand = colon === -1 ? grabberId : grabberId.slice(colon + 1);
		if (hand !== 'left' && hand !== 'right') return null;
		return { playerId: colon === -1 ? this.localPlayerId() : grabberId.slice(0, colon), hand };
	}

	getEquippedSlot(playerId: string, hand: EquipHand): string | null {
		return this.registry.getSlot(playerId, hand);
	}

	getHolderOfSlotOrAncestor(slotId: string): { playerId: string; hand: EquipHand } | null {
		let current = this.sceneGraph.getLive(slotId);
		while (current) {
			const holder = this.registry.getHolder(current.slot.id);
			if (holder) return { playerId: holder.playerId, hand: holder.hand };
			current = current.slot.parentId ? this.sceneGraph.getLive(current.slot.parentId) : undefined;
		}
		return null;
	}

	// --- GrabGuard -------------------------------------------------------

	canGrab(slotId: string, grabberId: string): boolean {
		if (this.getHolderOfSlotOrAncestor(slotId)) return false; // equipped objects are taken off first
		const who = this.parseGrabberId(grabberId);
		return !(who && this.registry.getSlot(who.playerId, who.hand)); // a hand holds one thing
	}

	// --- equip / unequip -------------------------------------------------

	/**
	 * Attaches `slotId` to `handNode` using the pose stored in its `equippable`
	 * component. If that hand is already occupied this fails unless `replace`
	 * is set. Returns whether the object is now equipped in that hand.
	 */
	equip(playerId: string, hand: EquipHand, handNode: TransformNode, slotId: string, options: { replace?: boolean } = {}): boolean {
		const live = this.sceneGraph.getLive(slotId);
		const equippable = live && isEquippable(live.slot);
		if (!live || !equippable) return false;

		const grabberId = this.grabberIdFor(playerId, hand);
		const heldByOthers = this.grabSystem.getGrabbersForSlot(slotId).some((id) => id !== grabberId);
		const heldSlot = this.grabSystem.getHeldSlot(grabberId);
		if (heldByOthers || (heldSlot && heldSlot !== slotId)) return false;

		const result = this.registry.equip(playerId, hand, slotId, options);
		if (!result.ok) return false;
		if (result.replaced) this.restore(result.replaced);

		// Hand the object over from the grab without re-parenting it or firing onRelease.
		if (heldSlot === slotId && this.grabSystem.detach(grabberId) === null) {
			this.registry.unequip(playerId, hand); // two-handed hold: not supported
			return false;
		}

		const pose = hand === 'left' ? equippable.left : equippable.right;
		live.node.setParent(handNode);
		live.node.position = Vector3.FromArray(pose.position);
		live.node.rotationQuaternion = Quaternion.FromArray(eulerToQuat(pose.rotation));
		this.handNodes.set(slotId, handNode);

		this.fire(slotId, playerId, hand, 'onEquip');
		this.onChanged.notifyObservers({ playerId, hand, slotId, previousSlotId: result.replaced });
		return true;
	}

	unequip(playerId: string, hand: EquipHand): boolean {
		const slotId = this.registry.unequip(playerId, hand);
		if (!slotId) return false;
		this.restore(slotId);
		this.fire(slotId, playerId, hand, 'onUnequip');
		this.onChanged.notifyObservers({ playerId, hand, slotId: null, previousSlotId: slotId });
		return true;
	}

	/** Disconnect or lost controller: free both hands of a player. */
	releasePlayer(playerId: string): void {
		for (const hand of ['left', 'right'] as const) this.unequip(playerId, hand);
	}

	/** World change or session end: nothing stays equipped. */
	releaseAll(): void {
		for (const entry of this.registry.list()) this.unequip(entry.playerId, entry.hand);
	}

	/**
	 * Guests mirror other players' equipment from the host's snapshot so their
	 * grab checks agree with the host. Their own hands are never touched here:
	 * the local equip/unequip is applied optimistically and confirmed by the host.
	 */
	applyRemote(entries: EquipmentEntry[], localPlayerId: string): void {
		const incoming = entries.filter((entry) => entry.playerId !== localPlayerId);
		for (const entry of this.registry.list()) {
			if (entry.playerId === localPlayerId) continue;
			if (!incoming.some((e) => e.playerId === entry.playerId && e.hand === entry.hand && e.slotId === entry.slotId)) {
				this.registry.unequip(entry.playerId, entry.hand);
			}
		}
		for (const entry of incoming) this.registry.equip(entry.playerId, entry.hand, entry.slotId, { replace: true });
	}

	// --- input -----------------------------------------------------------

	/**
	 * The object whose actions this hand's trigger drives: whatever is equipped
	 * in it, else — when the caller names one — the object currently held in
	 * that hand. Anything else (or a slot the hand doesn't actually hold) is
	 * refused, so a guest can't fire an object it isn't holding.
	 */
	getUsableSlot(playerId: string, hand: EquipHand, requestedSlotId?: string | null): string | null {
		const equipped = this.registry.getSlot(playerId, hand);
		if (equipped) return !requestedSlotId || requestedSlotId === equipped ? equipped : null;
		if (!requestedSlotId) return null;
		return this.grabSystem.getHeldSlot(this.grabberIdFor(playerId, hand)) === requestedSlotId ? requestedSlotId : null;
	}

	/** Whether the object driven by this hand's trigger (or any of its children) declares an `onTrigger` action. */
	hasTriggerAction(playerId: string, hand: EquipHand, requestedSlotId?: string | null): boolean {
		const slotId = this.getUsableSlot(playerId, hand, requestedSlotId);
		return Boolean(slotId && this.sceneGraph.getSubtree(slotId).some((entry) => entry.runtime?.onTrigger));
	}

	/**
	 * Delivers a trigger event to the root of the usable object and then its
	 * descendants. 'none' = nothing listens (normal trigger behaviour applies),
	 * 'consumed' = an action took it, 'passed' = actions ran but declined it.
	 */
	dispatchTrigger(playerId: string, hand: EquipHand, phase: TriggerEvent['phase'], value: number, requestedSlotId?: string | null): TriggerOutcome {
		const slotId = this.getUsableSlot(playerId, hand, requestedSlotId);
		if (!slotId) return 'none';
		const event: TriggerEvent = { hand, playerId, playerName: this.playerName(playerId), phase, value };
		let listening = false;
		let consumed = false;
		for (const entry of this.sceneGraph.getSubtree(slotId)) {
			const handler = entry.runtime?.onTrigger;
			if (!handler) continue;
			listening = true;
			if (handler(event) !== false) consumed = true;
		}
		return !listening ? 'none' : consumed ? 'consumed' : 'passed';
	}

	// --- internals -------------------------------------------------------

	/** Puts the node back under its real parent, keeping the world pose it had in the hand. */
	private restore(slotId: string): void {
		this.handNodes.delete(slotId);
		const live = this.sceneGraph.getLive(slotId);
		if (!live) return;
		const parentId = live.slot.parentId;
		live.node.setParent(parentId ? (this.sceneGraph.getLive(parentId)?.node ?? null) : null);
	}

	private fire(slotId: string, playerId: string, hand: EquipHand, hook: 'onEquip' | 'onUnequip'): void {
		const event: HandEvent = { hand, playerId, playerName: this.playerName(playerId) };
		for (const entry of this.sceneGraph.getSubtree(slotId)) {
			try {
				entry.runtime?.[hook]?.(event);
			} catch (err) {
				console.error(`[equipment] ${hook} threw for ${entry.slot.id}`, err);
			}
		}
	}

	private update(): void {
		for (const entry of this.registry.list()) {
			const live = this.sceneGraph.getLive(entry.slotId);
			const handNode = this.handNodes.get(entry.slotId);
			if (!live) {
				// Deleted: just drop the association (there is no node to restore).
				this.registry.releaseSlot(entry.slotId);
				this.handNodes.delete(entry.slotId);
				this.onChanged.notifyObservers({ playerId: entry.playerId, hand: entry.hand, slotId: null, previousSlotId: entry.slotId });
			} else if (handNode?.isDisposed()) {
				this.unequip(entry.playerId, entry.hand);
			}
		}
	}
}
