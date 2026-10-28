import type { Component, Slot } from '../../ecs/types.ts';

/**
 * What changed in one slot since the guests last heard of it, at the grain of a component: the components that are new or different
 * (whole, so applying one twice does no harm), the types that are gone, whether it is switched off. A script that rewrites the text of a
 * label costs the size of that label's `uiElement`, not of the world. A slot with two components of one type is sent as a whole list.
 */
export interface SlotDelta {
	id: string;
	set?: Component[];
	remove?: string[];
	/** The whole list, for a slot that has two components of one type. */
	components?: Component[];
	disabled?: boolean;
}

interface Known {
	/** Each component of the slot, as text, by type. */
	components: Map<string, string>;
	disabled: boolean;
}

const hasDuplicateTypes = (components: readonly Component[]): boolean => new Set(components.map((c) => c.type)).size !== components.length;

/** The host's memory of what its guests have: updated as deltas are made, and set to a whole scene whenever a snapshot goes out. */
export class DeltaTracker {
	private known = new Map<string, Known>();

	/** The guests have exactly this now (a snapshot was sent). */
	reset(tree: readonly Slot[]): void {
		this.known.clear();
		for (const slot of tree) this.known.set(slot.id, snapshotOf(slot));
	}

	forget(id: string): void {
		this.known.delete(id);
	}

	has(id: string): boolean {
		return this.known.has(id);
	}

	/** What the guests lack of `slot`, or null when nothing; remembers it as sent. */
	diff(slot: Slot): SlotDelta | null {
		const before = this.known.get(slot.id);
		const now = snapshotOf(slot);
		this.known.set(slot.id, now);
		if (hasDuplicateTypes(slot.components)) return before && sameSnapshot(before, now) ? null : { id: slot.id, components: slot.components, disabled: !!slot.disabled };
		const delta: SlotDelta = { id: slot.id };
		const set = slot.components.filter((c) => before?.components.get(c.type) !== now.components.get(c.type));
		const remove = before ? [...before.components.keys()].filter((type) => !now.components.has(type)) : [];
		if (set.length > 0) delta.set = set;
		if (remove.length > 0) delta.remove = remove;
		if (!before || before.disabled !== now.disabled) delta.disabled = now.disabled;
		return delta.set || delta.remove || (delta.disabled !== undefined && before !== undefined) ? delta : null;
	}
}

function snapshotOf(slot: Slot): Known {
	return { components: new Map(slot.components.map((c) => [c.type, JSON.stringify(c)])), disabled: !!slot.disabled };
}

function sameSnapshot(a: Known, b: Known): boolean {
	if (a.disabled !== b.disabled || a.components.size !== b.components.size) return false;
	for (const [type, text] of a.components) if (b.components.get(type) !== text) return false;
	return true;
}

/** The slot with a delta applied (a new object; the slot is not changed). */
export function applyDelta(slot: Slot, delta: SlotDelta): Slot {
	let components = delta.components ? delta.components : slot.components.filter((c) => !delta.remove?.includes(c.type));
	if (!delta.components && delta.set) {
		const replaced = new Set(delta.set.map((c) => c.type));
		components = [...components.filter((c) => !replaced.has(c.type)), ...delta.set];
		// Keep the order they had, where they had one: it is part of what a slot is.
		const order = new Map(slot.components.map((c, n) => [c.type, n]));
		components.sort((a, b) => (order.get(a.type) ?? 1e9) - (order.get(b.type) ?? 1e9));
	}
	const next: Slot = { ...slot, components };
	if (delta.disabled === true) next.disabled = true;
	else if (delta.disabled === false) delete next.disabled;
	return next;
}
