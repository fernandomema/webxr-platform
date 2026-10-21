/**
 * Pure bookkeeping for "which player has which object equipped in which
 * hand". It knows nothing about Babylon, so the rules (one object per hand,
 * one hand per object) can be unit-tested. EquipmentSystem owns the actual
 * node parenting on top of this.
 */

export type EquipHand = 'left' | 'right';

export interface EquipmentEntry {
	playerId: string;
	hand: EquipHand;
	slotId: string;
}

export type EquipResult = { ok: true; replaced: string | null } | { ok: false; reason: 'hand-occupied' | 'slot-equipped' };

const keyOf = (playerId: string, hand: EquipHand) => `${playerId}|${hand}`;

export function isEquipHand(value: unknown): value is EquipHand {
	return value === 'left' || value === 'right';
}

export class EquipmentRegistry {
	private byHand = new Map<string, EquipmentEntry>();
	private bySlot = new Map<string, EquipmentEntry>();

	/**
	 * A hand holds at most one object and an object sits in at most one hand.
	 * Equipping over an occupied hand only succeeds with `replace`, which is how
	 * a caller says "swap" explicitly instead of it happening by accident.
	 */
	equip(playerId: string, hand: EquipHand, slotId: string, options: { replace?: boolean } = {}): EquipResult {
		const holder = this.bySlot.get(slotId);
		if (holder && !(holder.playerId === playerId && holder.hand === hand)) return { ok: false, reason: 'slot-equipped' };
		const current = this.byHand.get(keyOf(playerId, hand));
		if (current && current.slotId !== slotId && !options.replace) return { ok: false, reason: 'hand-occupied' };
		if (current) this.remove(current);
		this.add({ playerId, hand, slotId });
		return { ok: true, replaced: current && current.slotId !== slotId ? current.slotId : null };
	}

	unequip(playerId: string, hand: EquipHand): string | null {
		const entry = this.byHand.get(keyOf(playerId, hand));
		if (!entry) return null;
		this.remove(entry);
		return entry.slotId;
	}

	getSlot(playerId: string, hand: EquipHand): string | null {
		return this.byHand.get(keyOf(playerId, hand))?.slotId ?? null;
	}

	getHolder(slotId: string): EquipmentEntry | null {
		return this.bySlot.get(slotId) ?? null;
	}

	/** Frees both hands of a player (disconnect, controller lost) and returns what was released. */
	releasePlayer(playerId: string): EquipmentEntry[] {
		const released = this.list().filter((entry) => entry.playerId === playerId);
		for (const entry of released) this.remove(entry);
		return released;
	}

	/** Frees whatever hand holds this slot (the object was deleted). */
	releaseSlot(slotId: string): EquipmentEntry | null {
		const entry = this.bySlot.get(slotId);
		if (entry) this.remove(entry);
		return entry ?? null;
	}

	list(): EquipmentEntry[] {
		return [...this.byHand.values()].map((entry) => ({ ...entry }));
	}

	clear(): EquipmentEntry[] {
		const all = this.list();
		this.byHand.clear();
		this.bySlot.clear();
		return all;
	}

	private add(entry: EquipmentEntry): void {
		this.byHand.set(keyOf(entry.playerId, entry.hand), entry);
		this.bySlot.set(entry.slotId, entry);
	}

	private remove(entry: EquipmentEntry): void {
		this.byHand.delete(keyOf(entry.playerId, entry.hand));
		this.bySlot.delete(entry.slotId);
	}
}
