/**
 * The tabs of the dash, as data: which there are, in what order, and how wide their buttons are. Nothing here
 * touches the GUI, so it can be tested on its own; `dashPanel.ts` draws what this holds.
 */
export interface TabSpec {
	/** Unique and stable; adding a tab with an id that exists replaces it. */
	id: string;
	label: string;
	/** The name of an icon (see icons.ts) shown before the label, or alone when the tabs are too many to fit their labels. */
	icon?: string;
	/** Lower comes first; tabs with the same order keep the order they were added in. Defaults to 1000, after the built-in ones. */
	order?: number;
}

export const DEFAULT_TAB_ORDER = 1000;

export class TabRegistry<T extends TabSpec = TabSpec> {
	private tabs: T[] = [];
	private listeners = new Set<() => void>();

	/** Adds a tab (or replaces the one with its id). Returns a function that removes it again. */
	add(tab: T): () => void {
		const at = this.tabs.findIndex((existing) => existing.id === tab.id);
		if (at >= 0) this.tabs[at] = tab;
		else this.tabs.push(tab);
		this.changed();
		return () => {
			if (this.tabs.includes(tab)) this.remove(tab.id);
		};
	}

	remove(id: string): boolean {
		const before = this.tabs.length;
		this.tabs = this.tabs.filter((tab) => tab.id !== id);
		if (this.tabs.length === before) return false;
		this.changed();
		return true;
	}

	get(id: string): T | undefined {
		return this.tabs.find((tab) => tab.id === id);
	}

	has(id: string): boolean {
		return this.tabs.some((tab) => tab.id === id);
	}

	/** The tabs in the order they are shown. */
	list(): T[] {
		return this.tabs
			.map((tab, index) => ({ tab, index }))
			.sort((a, b) => (a.tab.order ?? DEFAULT_TAB_ORDER) - (b.tab.order ?? DEFAULT_TAB_ORDER) || a.index - b.index)
			.map(({ tab }) => tab);
	}

	/** Calls `listener` whenever tabs are added, replaced or removed. Returns a function that stops it. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		for (const listener of this.listeners) listener();
	}
}

export interface TabBarLayout {
	/** Width of each tab button, in px. */
	width: number;
	/** Whether the labels fit next to the icons; when not, the buttons show their icon alone. */
	showLabels: boolean;
}

/** Sizes the buttons of `count` tabs to share `available` px: as wide as `maxWidth`, narrowing as tabs are added. */
export function tabBarLayout(count: number, available: number, options: { gap?: number; maxWidth?: number; minWidth?: number; labelWidth?: number } = {}): TabBarLayout {
	const { gap = 8, maxWidth = 160, minWidth = 56, labelWidth = 112 } = options;
	if (count <= 0) return { width: maxWidth, showLabels: true };
	const fair = Math.floor((available - gap * (count - 1)) / count);
	const width = Math.max(minWidth, Math.min(maxWidth, fair));
	return { width, showLabels: width >= labelWidth };
}
