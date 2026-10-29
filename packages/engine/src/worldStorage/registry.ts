import type { WorldItemStore } from './items.ts';

let current: WorldItemStore | null = null;

/** The store of saved objects the running game uses; the engine sets it up once, and the Dash and scripts reach it from here. */
export function setWorldItemStore(store: WorldItemStore | null): void {
	current = store;
}

export function getWorldItemStore(): WorldItemStore | null {
	return current;
}
