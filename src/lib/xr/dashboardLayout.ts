/**
 * What the Home tab of the personal menu can show, and the player's choice of which of it to show and in
 * what order. Pure, so the rules (unknown ids dropped, no repeats, order kept) are tested in Node.
 */

export const DASHBOARD_ITEMS = [
	{ id: 'seated', label: 'Seated mode' },
	{ id: 'inspector', label: 'Inspector' },
	{ id: 'exit-vr', label: 'Exit VR' }
] as const;

export type DashboardItemId = (typeof DASHBOARD_ITEMS)[number]['id'];

const IDS: readonly string[] = DASHBOARD_ITEMS.map((item) => item.id);

export const DEFAULT_DASHBOARD_LAYOUT: readonly DashboardItemId[] = DASHBOARD_ITEMS.map((item) => item.id);

export const dashboardItemLabel = (id: DashboardItemId): string => DASHBOARD_ITEMS.find((item) => item.id === id)?.label ?? id;

/** A saved layout made safe to use: only known ids, each once, in the saved order. Anything else falls back to the default. */
export function normalizeDashboardLayout(saved: unknown): DashboardItemId[] {
	if (!Array.isArray(saved)) return [...DEFAULT_DASHBOARD_LAYOUT];
	const seen = new Set<string>();
	const layout: DashboardItemId[] = [];
	for (const id of saved) {
		if (typeof id !== 'string' || !IDS.includes(id) || seen.has(id)) continue;
		seen.add(id);
		layout.push(id as DashboardItemId);
	}
	return layout;
}

/** Shows an item (at the end) or hides it. */
export function toggleDashboardItem(layout: readonly DashboardItemId[], id: DashboardItemId): DashboardItemId[] {
	return layout.includes(id) ? layout.filter((item) => item !== id) : [...layout, id];
}

/** Moves a shown item one place earlier (-1) or later (+1). */
export function moveDashboardItem(layout: readonly DashboardItemId[], id: DashboardItemId, direction: -1 | 1): DashboardItemId[] {
	const from = layout.indexOf(id);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= layout.length) return [...layout];
	const next = [...layout];
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

/** Every item, shown ones first in the player's order, then the hidden ones: what the customise screen lists. */
export function dashboardEditorOrder(layout: readonly DashboardItemId[]): { id: DashboardItemId; shown: boolean }[] {
	return [
		...layout.map((id) => ({ id, shown: true })),
		...DASHBOARD_ITEMS.filter((item) => !layout.includes(item.id)).map((item) => ({ id: item.id, shown: false }))
	];
}
