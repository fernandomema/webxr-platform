import type { Component, Slot, SlotTree } from '../ecs/types.ts';
import { collectAssetIds, type AssetId } from './ref.ts';

/**
 * A scene fragment: a piece of a world kept as an asset (a map, a room, a prefab) that is built where a `fragment` component asks
 * and taken down again when it is switched off, instead of living in the world's slot list all the time. Its slots are written
 * relative to the slot that loads it, so the same fragment can be loaded several times, anywhere.
 *
 * This module is only data: reading, writing, checking and expanding. Nothing here needs a browser.
 */
export const FRAGMENT_FORMAT = 'kithin-fragment';
export const FRAGMENT_VERSION = 1;

export const FRAGMENT_LIMITS = {
	/** Slots in one fragment. They are not in the world's own slot list, so this is the budget of a map, not of the world. */
	maxSlots: 6000,
	maxBytes: 6 * 1024 * 1024,
	/** Slots built at once from fragments in a scene; asking for more is refused instead of freezing a headset. */
	maxLiveSlots: 20_000
} as const;

/**
 * What a fragment may contain: scenery. Code, identity, portals and things to pick up are left to the world's own slots, where they
 * are saved, synced and reviewed like the rest; a fragment is the same on every device by construction.
 */
const ALLOWED = new Set<string>(['meshRenderer', 'material', 'collider', 'pointLight', 'spotLight', 'textDisplay', 'surfaceMask', 'mirror', 'particleEmitter', 'stroke', 'expires']);

export class FragmentError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = 'FragmentError';
	}
}

export interface FragmentData {
	format: typeof FRAGMENT_FORMAT;
	version: number;
	name?: string;
	/** Slots as in a world, except that a slot with no parent hangs from the slot that loads the fragment. */
	slots: Slot[];
}

const isVec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Checks the shape of a parsed fragment; throws a `FragmentError` saying what is wrong. */
export function validateFragment(value: unknown): FragmentData {
	const data = value as Partial<FragmentData> | null;
	if (!data || typeof data !== 'object' || data.format !== FRAGMENT_FORMAT) throw new FragmentError('not-a-fragment', 'This is not a scene fragment');
	if (data.version !== FRAGMENT_VERSION) throw new FragmentError('unsupported-version', `Unsupported fragment version ${String(data.version)}`);
	if (!Array.isArray(data.slots) || data.slots.length === 0) throw new FragmentError('empty', 'The fragment has no slots');
	if (data.slots.length > FRAGMENT_LIMITS.maxSlots) throw new FragmentError('too-many-slots', `A fragment may have at most ${FRAGMENT_LIMITS.maxSlots} slots`);
	if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > 120)) throw new FragmentError('invalid-name', 'Invalid fragment name');
	const ids = new Set<string>();
	for (const slot of data.slots as Slot[]) {
		if (!slot || typeof slot.id !== 'string' || !slot.id || slot.id.length > 120 || ids.has(slot.id) || typeof slot.name !== 'string' || !Array.isArray(slot.components) ||
			!isVec(slot.position, 3) || !isVec(slot.rotation, 4) || !isVec(slot.scale, 3)) throw new FragmentError('invalid-slot', `Invalid fragment slot ${String((slot as Partial<Slot> | null)?.id)}`);
		ids.add(slot.id);
		for (const component of slot.components as Component[]) {
			if (!component || typeof component.type !== 'string' || !ALLOWED.has(component.type)) throw new FragmentError('component-not-allowed', `A fragment cannot contain a "${String((component as Partial<Component> | null)?.type)}" component (slot ${slot.id})`);
		}
	}
	for (const slot of data.slots as Slot[]) {
		if (slot.parentId !== null && slot.parentId !== undefined && !ids.has(slot.parentId)) throw new FragmentError('missing-parent', `Slot ${slot.id} has a parent that is not in the fragment`);
		const seen = new Set([slot.id]);
		for (let parent = slot.parentId ?? null; parent; parent = data.slots.find((s) => s.id === parent)?.parentId ?? null) {
			if (seen.has(parent)) throw new FragmentError('cycle', 'The fragment hierarchy contains a cycle');
			seen.add(parent);
		}
	}
	return data as FragmentData;
}

/** Reads a fragment file. */
export function parseFragment(bytes: Uint8Array | string): FragmentData {
	if (typeof bytes !== 'string' && bytes.byteLength > FRAGMENT_LIMITS.maxBytes) throw new FragmentError('too-large', 'The fragment is too large');
	let value: unknown;
	try {
		value = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
	} catch {
		throw new FragmentError('not-a-fragment', 'This is not a scene fragment');
	}
	return validateFragment(value);
}

/** Writes a fragment file. The format is the first thing in it, so that the file is recognised from its first bytes. */
export function serializeFragment(slots: SlotTree, name?: string): Uint8Array {
	const data: FragmentData = { format: FRAGMENT_FORMAT, version: FRAGMENT_VERSION, ...(name ? { name } : {}), slots: slots.map((slot) => ({ ...slot, parentId: slot.parentId ?? null })) };
	validateFragment(data);
	return new TextEncoder().encode(JSON.stringify(data));
}

/** The assets a fragment's slots use, for the manifest and for sharing. */
export function fragmentAssets(data: FragmentData): AssetId[] {
	return [...collectAssetIds(data.slots)];
}

/** The id a fragment's slot has once loaded by `ownerId`. */
export function fragmentSlotId(ownerId: string, id: string): string {
	return `${ownerId}::${id}`;
}

/** The slots a fragment is made of when loaded by `owner`: ids made unique to it, the roots hung from it. */
export function instantiateFragment(ownerId: string, data: FragmentData): Slot[] {
	return data.slots.map((slot) => ({
		...slot,
		id: fragmentSlotId(ownerId, slot.id),
		parentId: slot.parentId ? fragmentSlotId(ownerId, slot.parentId) : ownerId
	}));
}

/**
 * The scene with every `fragment` slot's content in it, for what has to see the whole world at once (baking light, measuring, tests).
 * `resolve` gives a fragment's data by asset id; one it cannot give is left out. Enabled or not, a fragment is expanded unless
 * `onlyEnabled` is set.
 */
export function expandFragments(tree: SlotTree, resolve: (assetId: AssetId) => FragmentData | undefined, options: { onlyEnabled?: boolean } = {}): SlotTree {
	const out: Slot[] = [...tree];
	const byId = new Map(tree.map((slot) => [slot.id, slot]));
	const disabled = (slot: Slot): boolean => {
		for (let s: Slot | undefined = slot, guard = 0; s && guard < 64; s = s.parentId ? byId.get(s.parentId) : undefined, guard++) if (s.disabled) return true;
		return false;
	};
	for (const slot of tree) {
		const component = slot.components.find((c) => c.type === 'fragment') as { source?: { kind?: string; assetId?: AssetId } } | undefined;
		if (!component || component.source?.kind !== 'asset' || !component.source.assetId) continue;
		if (options.onlyEnabled && disabled(slot)) continue;
		const data = resolve(component.source.assetId);
		if (data) out.push(...instantiateFragment(slot.id, data));
	}
	return out;
}
