import type { SlotTree } from '../ecs/types.ts';
import type { AssetId } from '../assets/ref.ts';
import { validateExternalTree } from '../inventory/external.ts';

/**
 * Objects a world saves for the person hosting it: a record put on a shelf, a creation kept for next time. They are nodes (a slot
 * tree with the assets it uses), like an inventory, kept per published world and per host. Whoever plays in a session saves into the
 * host's, because it is the host's session. Where they are kept is the host's choice: on this device, or in the cloud.
 */
export type WorldItemLocation = 'local' | 'cloud';
export const WORLD_ITEM_LOCATIONS: readonly WorldItemLocation[] = ['local', 'cloud'];

export const WORLD_ITEM_LIMITS = {
	/** Objects one host may keep for one published world. */
	maxItems: 200,
	/** Size of one object once serialized. */
	maxBytes: 2 * 1024 * 1024,
	maxNameLength: 120
} as const;

/** A name a script gives an object, the same for every host: it is how the world finds it again. */
export const WORLD_ITEM_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

export interface WorldItem {
	id: string;
	key: string | null;
	name: string;
	slotData: SlotTree;
	thumbnailAssetId: AssetId | null;
	createdAt: string;
}

export interface WorldItemInput {
	/** Replaces this object. Without it, an object with the same `key` is replaced, if there is one. */
	id?: string;
	key?: string | null;
	name: string;
	slotData: SlotTree;
	thumbnailAssetId?: AssetId | null;
}

/** Names an object by its id, or by the key it was saved under. */
export interface WorldItemRef {
	id?: string;
	key?: string;
}

export class WorldItemError extends Error {
	constructor(readonly code: 'unavailable' | 'invalid' | 'limit' | 'quota' | 'not-found', message: string) {
		super(message);
		this.name = 'WorldItemError';
	}
}

/** Checks what a script or the Dash asks to save. */
export function validateWorldItemInput(input: WorldItemInput): void {
	if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > WORLD_ITEM_LIMITS.maxNameLength) throw new WorldItemError('invalid', 'Invalid name');
	if (input.key != null && (typeof input.key !== 'string' || !WORLD_ITEM_KEY.test(input.key))) throw new WorldItemError('invalid', 'A key is up to 64 letters, digits, "_", ".", ":" or "-"');
	try {
		validateExternalTree(input.slotData);
	} catch (error) {
		throw new WorldItemError('invalid', error instanceof Error ? error.message : 'Invalid object');
	}
	if (JSON.stringify(input.slotData).length > WORLD_ITEM_LIMITS.maxBytes) throw new WorldItemError('limit', 'The object is too large to keep');
}

/** One place objects are kept. All of them are scoped to a published world; the host's identity is the backend's concern. */
export interface WorldItemBackend {
	readonly location: WorldItemLocation;
	/** Whether it can be used now (the cloud needs an account). */
	available(): boolean;
	list(publicationId: string): Promise<WorldItem[]>;
	find(publicationId: string, ref: WorldItemRef): Promise<WorldItem | null>;
	save(publicationId: string, input: WorldItemInput): Promise<WorldItem>;
	remove(publicationId: string, id: string): Promise<void>;
}

export interface WorldItemStore {
	/** Where new objects are kept now. */
	readonly location: WorldItemLocation;
	/** Whether objects can be saved now: a published world is running and the chosen place can be used. */
	available(): boolean;
	list(): Promise<WorldItem[]>;
	/** Looks where objects are kept, then in the other place: the host may have changed the setting since saving. */
	find(ref: WorldItemRef): Promise<WorldItem | null>;
	/** Writes to the chosen place only. */
	save(input: WorldItemInput): Promise<WorldItem>;
	/** Takes the object out of both places, so one that was deleted does not come back through the fallback. Whether there was one. */
	remove(ref: WorldItemRef): Promise<boolean>;
}

export interface WorldItemStoreDeps {
	backends: Record<WorldItemLocation, WorldItemBackend>;
	getLocation(): WorldItemLocation;
	/** The published world being hosted; null when there is none (a draft, or being a guest), and then nothing can be kept. */
	getPublicationId(): string | null;
}

export function createWorldItemStore(deps: WorldItemStoreDeps): WorldItemStore {
	const chosen = () => deps.backends[deps.getLocation()];
	const other = () => deps.backends[deps.getLocation() === 'local' ? 'cloud' : 'local'];
	return {
		get location() { return deps.getLocation(); },
		available() { return deps.getPublicationId() !== null && chosen().available(); },
		async list() {
			const publicationId = deps.getPublicationId();
			return publicationId && chosen().available() ? chosen().list(publicationId) : [];
		},
		async find(ref) {
			const publicationId = deps.getPublicationId();
			if (!publicationId || (!ref.id && !ref.key)) return null;
			for (const backend of [chosen(), other()]) {
				if (!backend.available()) continue;
				try {
					const item = await backend.find(publicationId, ref);
					if (item) return item;
				} catch {
					// A place that cannot be reached is the same as one that has nothing: try the other.
				}
			}
			return null;
		},
		async save(input) {
			const publicationId = deps.getPublicationId();
			if (!publicationId || !chosen().available()) throw new WorldItemError('unavailable', 'Saving is not available here');
			validateWorldItemInput(input);
			const backend = chosen();
			const existing = input.id
				? (await backend.find(publicationId, { id: input.id })) ?? (other().available() ? await other().find(publicationId, { id: input.id }).catch(() => null) : null)
				: input.key ? await backend.find(publicationId, { key: input.key }) : null;
			// An object edited by id stays where it is; anything new goes to the chosen place.
			const target = existing && !(await backend.find(publicationId, { id: existing.id })) ? other() : backend;
			if (!existing && (await backend.list(publicationId)).length >= WORLD_ITEM_LIMITS.maxItems) throw new WorldItemError('limit', `At most ${WORLD_ITEM_LIMITS.maxItems} objects can be kept per world`);
			return target.save(publicationId, { ...input, id: existing?.id });
		},
		async remove(ref) {
			const publicationId = deps.getPublicationId();
			if (!publicationId || (!ref.id && !ref.key)) return false;
			let removed = false;
			for (const backend of [chosen(), other()]) {
				if (!backend.available()) continue;
				const item = await backend.find(publicationId, ref).catch(() => null);
				if (!item) continue;
				await backend.remove(publicationId, item.id);
				removed = true;
			}
			return removed;
		}
	};
}

/** A backend that keeps everything in memory: for tests, and for places with no storage. */
export function createMemoryWorldItemBackend(location: WorldItemLocation, options: { available?: () => boolean } = {}): WorldItemBackend & { items: Map<string, WorldItem & { publicationId: string }> } {
	const items = new Map<string, WorldItem & { publicationId: string }>();
	let counter = 0;
	return {
		location,
		items,
		available: options.available ?? (() => true),
		async list(publicationId) {
			return [...items.values()].filter((item) => item.publicationId === publicationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ publicationId: _p, ...item }) => item);
		},
		async find(publicationId, ref) {
			const found = [...items.values()].find((item) => item.publicationId === publicationId && (ref.id ? item.id === ref.id : item.key === ref.key));
			if (!found) return null;
			const { publicationId: _p, ...item } = found;
			return item;
		},
		async save(publicationId, input) {
			const id = input.id ?? `${location}-${++counter}`;
			const previous = items.get(id);
			const item = { id, publicationId, key: input.key ?? previous?.key ?? null, name: input.name, slotData: input.slotData, thumbnailAssetId: input.thumbnailAssetId ?? previous?.thumbnailAssetId ?? null, createdAt: previous?.createdAt ?? new Date().toISOString() };
			items.set(id, item);
			const { publicationId: _p, ...plain } = item;
			return plain;
		},
		async remove(_publicationId, id) {
			items.delete(id);
		}
	};
}
