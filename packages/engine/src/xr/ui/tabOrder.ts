/**
 * The order the player has put the tabs of the menu in, kept between sessions. Pure (the storage is passed in), so the rules are
 * tested in Node.
 */

/** `tabs` in the player's order: the ones they placed first, as they placed them, then the others as they were (a tab added since goes last). */
export function applyTabOrder<T extends { id: string }>(tabs: readonly T[], saved: readonly string[]): T[] {
	const rank = new Map(saved.map((id, index) => [id, index]));
	const placed = tabs.filter((tab) => rank.has(tab.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
	return [...placed, ...tabs.filter((tab) => !rank.has(tab.id))];
}

/** `ids` with `id` taken out and put back at `to` (clamped). Unchanged for an id that is not there. */
export function moveTab(ids: readonly string[], id: string, to: number): string[] {
	const from = ids.indexOf(id);
	if (from < 0) return [...ids];
	const rest = ids.filter((other) => other !== id);
	rest.splice(Math.min(rest.length, Math.max(0, to)), 0, id);
	return rest;
}

/**
 * What a reordering of the tabs on show means for all of them: the shown ones take each other's places among the whole list, and
 * the tabs on other pages of the bar stay where they were.
 */
export function mergeShownOrder(all: readonly string[], shownBefore: readonly string[], shownAfter: readonly string[]): string[] {
	const shown = new Set(shownBefore);
	let next = 0;
	return all.map((id) => (shown.has(id) ? shownAfter[next++] ?? id : id));
}

/** The order to keep once `current` (the tabs now, in order) is the order wanted: ids kept from before that are not here now stay at the end, so a tab that comes back is where it was left. */
export function orderToKeep(current: readonly string[], saved: readonly string[]): string[] {
	const here = new Set(current);
	return [...current, ...saved.filter((id) => !here.has(id))];
}

const STORAGE_KEY = 'webxr-platform-dash-tab-order';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadTabOrder(storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage): string[] {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
		return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))].slice(0, 200) : [];
	} catch {
		return [];
	}
}

export function saveTabOrder(ids: readonly string[], storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(ids));
		return true;
	} catch {
		return false;
	}
}
