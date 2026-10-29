import type { SlotTree } from '../ecs/types.ts';
import { withoutExternal } from '../ecs/serialize.ts';
import { WORLD_ITEM_KEY, WorldItemError, type WorldItemStore } from '../worldStorage/items.ts';

/** What `ctx.storage.items` gives a script: the objects the world has saved for the person hosting it. */
export interface ScriptWorldItems {
	readonly available: boolean;
	/** Saves the object that starts at `slotId` (it and everything under it) under `key`, replacing what was saved there. Resolves whether it was saved. */
	save(key: string, slotId: string, options?: { name?: string }): Promise<boolean>;
	/** What is saved, as `{ key, name }`; objects saved without a key (from the Dash) have `key` null. */
	list(): Promise<Array<{ key: string | null; name: string }>>;
	has(key: string): Promise<boolean>;
	remove(key: string): Promise<boolean>;
}

/**
 * `subtree` gives the slots of the object at a slot (null when there is none). The object is saved at the origin, as it is: where it
 * happens to stand in the world is not part of it, so it can be put anywhere when it is loaded again.
 */
export function createScriptWorldItems(store: WorldItemStore, subtree: (slotId: string) => SlotTree | null, isHost: () => boolean): ScriptWorldItems {
	const validKey = (key: unknown): key is string => typeof key === 'string' && WORLD_ITEM_KEY.test(key);
	return {
		get available() { return isHost() && store.available(); },
		async save(key, slotId, options) {
			if (!isHost() || !validKey(key) || typeof slotId !== 'string') return false;
			const tree = subtree(slotId);
			if (!tree?.length) return false;
			const [root, ...rest] = withoutExternal(tree);
			const name = typeof options?.name === 'string' && options.name.trim() ? options.name.trim().slice(0, 120) : root.name || key;
			try {
				await store.save({ key, name, slotData: [{ ...root, parentId: null, position: [0, 0, 0], rotation: [0, 0, 0, 1] }, ...rest] });
				return true;
			} catch (error) {
				if (error instanceof WorldItemError) return false;
				throw error;
			}
		},
		async list() {
			if (!isHost()) return [];
			return (await store.list()).map((item) => ({ key: item.key, name: item.name }));
		},
		async has(key) {
			return isHost() && validKey(key) && (await store.find({ key })) !== null;
		},
		async remove(key) {
			return isHost() && validKey(key) && store.remove({ key });
		}
	};
}
