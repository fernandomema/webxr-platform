import type { Slot, SlotTree } from '../ecs/types.ts';
import { migrateSlotTree } from '../assets/ref.ts';

/**
 * Objects that live outside the world and are built into it while it runs: a loader (or a script) names where one is, the host
 * reads it and every peer sees the slots it made. Only sources anyone can read are allowed, so a world works the same for every
 * host: the starter kit, objects from the marketplace, objects the owner made public, and the host's own world storage.
 */
export const EXTERNAL_ADAPTERS = ['builtin', 'marketplace', 'cloud', 'worldStorage'] as const;
export type ExternalAdapter = (typeof EXTERNAL_ADAPTERS)[number];

/** `id` names the object. `worldStorage` objects can instead be named by the `key` a script saved them under, which is the same for every host. */
export interface ExternalSource {
	adapter: ExternalAdapter;
	id?: string;
	key?: string;
}

export const EXTERNAL_LIMITS = {
	/** Slots one object may bring. */
	maxSlots: 5000,
	/** Size of the object once serialized. */
	maxBytes: 8 * 1024 * 1024,
	/** Slots built from external objects at once, in the whole scene. */
	maxLiveSlots: 20_000,
	/** How many objects may be inside one another (a loader inside an object a loader brought). */
	maxDepth: 4
} as const;

const MAX_REF_LENGTH = 200;

export class ExternalItemError extends Error {
	constructor(readonly code: 'invalid-source' | 'not-found' | 'unavailable' | 'invalid-item' | 'too-large' | 'too-deep' | 'cycle', message: string) {
		super(message);
		this.name = 'ExternalItemError';
	}
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= MAX_REF_LENGTH ? value : undefined);

/** Reads a source in the shape components and scripts give it; null when it does not name one of the allowed objects. */
export function normalizeExternalSource(value: unknown): ExternalSource | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as { adapter?: unknown; id?: unknown; key?: unknown };
	if (!(EXTERNAL_ADAPTERS as readonly unknown[]).includes(raw.adapter)) return null;
	const adapter = raw.adapter as ExternalAdapter;
	const id = text(raw.id);
	const key = text(raw.key);
	if (adapter === 'worldStorage') return id || key ? { adapter, ...(id ? { id } : {}), ...(key ? { key } : {}) } : null;
	return id ? { adapter, id } : null;
}

/** A stable string for a source, to compare them and to catch an object that contains itself. */
export function externalSourceKey(source: ExternalSource): string {
	return `${source.adapter}:${source.id ?? ''}:${source.key ?? ''}`;
}

/**
 * Checks an object a source returned before anything is built from it. It is data from outside, so its shape is verified; the
 * `external` mark is dropped (it is set here, not read), and ids are made sure to be unique.
 */
export function validateExternalTree(value: unknown): SlotTree {
	if (!Array.isArray(value) || value.length === 0) throw new ExternalItemError('invalid-item', 'The object has no slots');
	if (value.length > EXTERNAL_LIMITS.maxSlots) throw new ExternalItemError('too-large', `An object may bring at most ${EXTERNAL_LIMITS.maxSlots} slots`);
	if (JSON.stringify(value).length > EXTERNAL_LIMITS.maxBytes) throw new ExternalItemError('too-large', 'The object is too large');
	const ids = new Set<string>();
	const vec = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
	const tree = migrateSlotTree(value);
	for (const slot of tree) {
		if (!slot || typeof slot.id !== 'string' || !slot.id || slot.id.length > 120 || ids.has(slot.id) || typeof slot.name !== 'string' || !Array.isArray(slot.components) ||
			!vec(slot.position, 3) || !vec(slot.rotation, 4) || !vec(slot.scale, 3)) throw new ExternalItemError('invalid-item', `Invalid slot ${String((slot as Partial<Slot> | null)?.id)}`);
		ids.add(slot.id);
	}
	if (!tree.some((slot) => !slot.parentId || !ids.has(slot.parentId))) throw new ExternalItemError('invalid-item', 'The object has no root');
	return tree.map(({ external: _external, ...slot }) => slot);
}

/** The id a slot of an external object has once built by `ownerId`. */
export const externalSlotId = (ownerId: string, id: string): string => `${ownerId}::${id}`;

/**
 * The slots to build for `ownerId`: ids made unique to it (so the same object can be built any number of times), the roots hung
 * from `parentId` (the owner, or the parent a script chose), everything marked `external`. `pose` replaces the roots' own placement.
 */
export function instantiateExternal(ownerId: string, tree: SlotTree, parentId: string | null, pose: Partial<Pick<Slot, 'position' | 'rotation' | 'scale'>> = {}): Slot[] {
	const ids = new Set(tree.map((slot) => slot.id));
	return tree.map((slot) => {
		const root = !slot.parentId || !ids.has(slot.parentId);
		return {
			...slot,
			id: externalSlotId(ownerId, slot.id),
			parentId: root ? parentId : externalSlotId(ownerId, slot.parentId!),
			...(root ? pose : {}),
			external: true
		};
	});
}

/** Where saved objects of the host's world storage are read from; supplied by the engine, which owns the storage. */
export interface WorldStorageReader {
	read(ref: { id?: string; key?: string }): Promise<{ name: string; slotData: SlotTree } | null>;
}

export interface ExternalItem {
	name: string;
	slots: SlotTree;
}

export type ExternalResolver = (source: ExternalSource, signal?: AbortSignal) => Promise<ExternalItem>;
