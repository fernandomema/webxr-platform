import { platformFetch } from '../xr/platform/config.ts';
import { getContent } from '../xr/content/registry.ts';
import type { SlotTree } from '../ecs/types.ts';
import { ExternalItemError, type ExternalResolver, type WorldStorageReader } from './external.ts';

/** The part of `external.ts` that talks to the server and the game's content, kept apart so the rules there can be used anywhere. */
async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
	let response: Response;
	try {
		response = await platformFetch(path, { signal });
	} catch {
		throw new ExternalItemError('unavailable', 'The server could not be reached');
	}
	if (response.status === 404 || response.status === 403 || response.status === 401) throw new ExternalItemError('not-found', 'The object does not exist or is not public');
	if (!response.ok) throw new ExternalItemError('unavailable', `The server answered ${response.status}`);
	return response.json();
}

/** Reads objects from the allowed sources. Whatever comes back is checked with `validateExternalTree` by the caller. */
export function createExternalResolver(deps: { worldStorage?: WorldStorageReader } = {}): ExternalResolver {
	return async (source, signal) => {
		switch (source.adapter) {
			case 'builtin': {
				const kit = await getContent().loadStarterKit?.();
				const wanted = source.id!.replace(/^builtin:/, '');
				const entry = kit?.entries.find((candidate) => candidate.id === wanted);
				if (!entry) throw new ExternalItemError('not-found', `There is no starter object "${wanted}"`);
				return { name: entry.name, slots: entry.build() };
			}
			case 'marketplace': {
				// TODO: check the price when the marketplace has paid items; every item is free for now.
				const item = (await fetchJson(`/api/marketplace/items/${encodeURIComponent(source.id!)}`, signal)) as { name?: string; slotData?: SlotTree };
				return { name: item.name ?? 'Marketplace object', slots: item.slotData as SlotTree };
			}
			case 'cloud': {
				const item = (await fetchJson(`/api/public/inventory/${encodeURIComponent(source.id!)}`, signal)) as { name?: string; slotData?: SlotTree };
				return { name: item.name ?? 'Object', slots: item.slotData as SlotTree };
			}
			case 'worldStorage': {
				if (!deps.worldStorage) throw new ExternalItemError('unavailable', 'World storage is not available here');
				const item = await deps.worldStorage.read({ id: source.id, key: source.key });
				if (!item) throw new ExternalItemError('not-found', 'Nothing is saved there');
				return { name: item.name, slots: item.slotData };
			}
		}
	};
}
