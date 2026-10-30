import type { Scene, TransformNode } from '@babylonjs/core';
import { Control, Rectangle } from '@babylonjs/gui';
import { createSlot, findComponent, type Slot, type SlotTree } from '../../ecs/types.ts';
import { SceneGraph, type SceneGraphOptions } from '../sceneGraph.ts';
import type { UIPanelContainer } from '../uiPanelSurface.ts';
import type { ScriptDash, ScriptDashTab, ScriptSystem } from '../scriptDash.ts';
import { cellRect, fitPanel, widgetSlots, type Grid, type GridWidget } from './dashGrid.ts';

const MAX_TABS_PER_WIDGET = 8;
const MAX_TAB_SLOTS = 300;

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WidgetRuntimeOptions {
	/** What a piece of UI's scripts may ask of the game. They run in a world of their own (see below). */
	graph: Pick<SceneGraphOptions, 'getUiContext' | 'openDash' | 'getViewerPosition' | 'getPlayers'>;
	system: ScriptSystem;
	/** The few settings a script may read and change. */
	settings: { get(key: string): number | null; set(key: string, value: number): boolean };
	/** The tabs of the menu: adds one (its page is where the tab's UI is drawn; `remove` takes the tab off the bar), and opens one. */
	tabs: { add(id: string, spec: { label: string; icon?: string; order?: number }): { page: Rectangle; remove(): void }; show(id: string): void };
	/** The size of a tab's page (px), and what the in-world keyboard comes up beside for the controls on it. */
	pageSize: { width: number; height: number };
	pageNear: () => TransformNode | null;
}

/** The pieces of UI of one grid, run and drawn where that grid is. */
export interface WidgetView {
	/** Makes what runs match the grid: pieces of UI added start, removed ones stop, moved or resized ones are laid out again. */
	sync(grid: Grid): void;
	/** Hides or shows the pieces of UI (they are hidden while the grid is edited, when the cells stand in for them). */
	setHidden(hidden: boolean): void;
	/** Stops every piece of UI of this grid, and the tabs they added. */
	dispose(): void;
}

export interface WidgetRuntime {
	/**
	 * A grid's pieces of UI: each is drawn inside `parent` in the box `areaOf` gives it (px of `parent`). `near` is what the in-world keyboard
	 * comes up beside for their text fields.
	 */
	view(parent: Rectangle, areaOf: (widget: GridWidget) => Rect, near: () => TransformNode | null): WidgetView;
	dispose(): void;
}

interface Running {
	/** The widget it belongs to. */
	widgetId: string;
	rootId: string;
	/** The control the panel is drawn in (as big as the panel is in its own pixels, scaled to fit its box) and the control that holds it. */
	container: Rectangle;
	parent: Rectangle;
	/** The panel's size in its own pixels. */
	panel: { width: number; height: number };
	/** The box (px of its parent) it is fitted into. */
	area(): Rect;
	/** What it was last laid out for, so only a changed one is laid out again. */
	laidOut: unknown;
	/** A tab's page: taking the tab off the bar. */
	removeTab?: () => void;
}

/**
 * Runs the pieces of UI a player pinned to their Home grid, and draws each inside the dash's own picture, over its cells. They
 * are real slots with their scripts, but in a scene graph of their own, not the world's: they are the player's and go with them
 * from world to world, so what they do can only reach themselves (and what the game lends them in `graph`, `system` and the
 * tabs). A script that reaches for the world's slots finds none. Each runs on the player's device alone, which is also what
 * makes them work as a guest. They may add tabs to the menu, whose pages are UI of the same kind.
 *
 * Being drawn in the dash's picture (not as panels floating over it) is what makes them bend with it, scale with it, take the
 * pointer like the rest of it and show on a desktop screen with no special care.
 */
export function createWidgetRuntime(scene: Scene, options: WidgetRuntimeOptions): WidgetRuntime {
	const dashApi: ScriptDash = {
		addTab: (owner, tab) => addTab(owner, tab),
		removeTab: (owner, id) => removeTab(owner, id),
		showTab: (owner, id) => {
			const widgetId = widgetOf(owner);
			if (!widgetId || !tabsOf.get(widgetId)?.has(id)) return false;
			options.tabs.show(menuTabId(widgetId, id));
			return true;
		},
		instanceId: (owner) => widgetOf(owner),
		getSetting: (key) => options.settings.get(key),
		setSetting: (key, value) => options.settings.set(key, value)
	};
	/** The control each panel of this scene is to be drawn in, until its slot is built. */
	const containers = new Map<string, UIPanelContainer>();
	// `world.spawn` and the like are not lent: whatever a script puts in the menu goes through `dash.addTab`.
	const graph = new SceneGraph(scene, { ...options.graph, isHost: () => true, dash: dashApi, system: options.system, uiPanelContainer: (slotId) => containers.get(slotId) ?? null });
	/** Every piece that is on the dash: a widget's own panel, and the pages of the tabs it added. */
	const running = new Map<string, Running>();
	/** The widget each root slot belongs to, kept from before it starts so a script can add a tab as it starts. */
	const widgetByRoot = new Map<string, string>();
	/** The tabs each widget added, by the id the script gave: the key of their page in `running`. */
	const tabsOf = new Map<string, Map<string, string>>();

	const menuTabId = (widgetId: string, id: string) => `ext-${widgetId}-${id}`;
	const widgetKey = (widgetId: string) => `widget:${widgetId}`;

	/** The widget a slot of the menu's own scene belongs to. */
	function widgetOf(slotId: string): string | null {
		for (let at: string | null = slotId, hops = 0; at && hops < 64; hops++) {
			const found = widgetByRoot.get(at);
			if (found) return found;
			at = graph.getLive(at)?.slot.parentId ?? null;
		}
		return null;
	}

	function layout(entry: Running): void {
		const rect = entry.area();
		const fitted = fitPanel(entry.panel, rect);
		entry.container.scaleX = entry.container.scaleY = fitted.scale;
		// The control is as big as the panel and is scaled about its middle, so it is put where its middle must be.
		entry.container.left = `${rect.x + fitted.x + fitted.width / 2 - entry.panel.width / 2}px`;
		entry.container.top = `${rect.y + fitted.y + fitted.height / 2 - entry.panel.height / 2}px`;
	}

	function mount(key: string, widgetId: string, tree: SlotTree, parent: Rectangle, area: () => Rect, near: () => TransformNode | null, hidden: boolean, removeTab?: () => void): Running | null {
		const rootSlot = tree[0];
		const panel = rootSlot && findComponent(rootSlot, 'uiPanel');
		if (!panel) return null;
		const container = new Rectangle(`widget-${key}`);
		container.thickness = 0;
		container.width = `${panel.width}px`;
		container.height = `${panel.height}px`;
		container.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		container.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		container.isVisible = !hidden;
		parent.addControl(container);
		containers.set(rootSlot.id, { container, near });
		let built = false;
		try {
			graph.load(tree);
			built = Boolean(graph.getLive(rootSlot.id));
		} catch (error) {
			console.error('[dash] a piece of UI could not start', error);
		} finally {
			containers.delete(rootSlot.id);
		}
		if (!built) {
			graph.removeSlot(rootSlot.id);
			parent.removeControl(container);
			container.dispose();
			return null;
		}
		const entry: Running = { widgetId, rootId: rootSlot.id, container, parent, panel: { width: panel.width, height: panel.height }, area, laidOut: null, removeTab };
		running.set(key, entry);
		layout(entry);
		return entry;
	}

	function unmount(key: string): void {
		const entry = running.get(key);
		if (!entry) return;
		running.delete(key);
		graph.removeSlot(entry.rootId);
		if (entry.parent.children.includes(entry.container)) entry.parent.removeControl(entry.container);
		entry.container.dispose();
		entry.removeTab?.();
	}

	/** Stops a piece of UI and the tabs it added. */
	function stopWidget(widgetId: string): void {
		const entry = running.get(widgetKey(widgetId));
		for (const id of [...(tabsOf.get(widgetId)?.keys() ?? [])]) dropTab(widgetId, id);
		tabsOf.delete(widgetId);
		if (entry) widgetByRoot.delete(entry.rootId);
		unmount(widgetKey(widgetId));
	}

	// --- Tabs added by scripts ---

	/** The slots a script wrote for a tab's page, made safe to run: fresh ids, the first one a panel, the rest under it. */
	function pageSlots(ui: NonNullable<ScriptDashTab['ui']>): { tree: SlotTree; slots: Record<string, string> } | null {
		if (ui.length === 0 || ui.length > MAX_TAB_SLOTS) return null;
		const ids = new Map<string, string>();
		for (const partial of ui) if (typeof partial.id === 'string' && partial.id && !ids.has(partial.id)) ids.set(partial.id, crypto.randomUUID());
		const tree: SlotTree = ui.map((partial, index): Slot => {
			const id = (typeof partial.id === 'string' && ids.get(partial.id)) || crypto.randomUUID();
			const given = typeof partial.parentId === 'string' ? ids.get(partial.parentId) : undefined;
			return createSlot({
				id, name: String(partial.name).slice(0, 80),
				parentId: index === 0 ? null : (given ?? null),
				components: Array.isArray(partial.components) ? partial.components : []
			});
		});
		// A slot whose parent is not one of these goes under the panel, and parents come before their children.
		const rootId = tree[0].id;
		for (const slot of tree.slice(1)) if (slot.parentId === null) slot.parentId = rootId;
		const placed = new Set<string>([rootId]);
		const ordered: SlotTree = [tree[0]];
		let pending = tree.slice(1);
		while (pending.length > 0) {
			const next = pending.filter((slot) => slot.parentId !== null && placed.has(slot.parentId));
			if (next.length === 0) return null; // a cycle or a lost parent
			for (const slot of next) { ordered.push(slot); placed.add(slot.id); }
			pending = pending.filter((slot) => !placed.has(slot.id));
		}
		const panel = findComponent(tree[0], 'uiPanel');
		if (!panel || !(panel.width > 0) || !(panel.height > 0) || panel.width > 4096 || panel.height > 4096) return null;
		const slots: Record<string, string> = {};
		for (const [given, real] of ids) slots[given] = real;
		return { tree: ordered, slots };
	}

	function addTab(owner: string, tab: ScriptDashTab): { slots: Record<string, string> } | null {
		const widgetId = widgetOf(owner);
		if (!widgetId || !tab.ui) return null;
		const tabs = tabsOf.get(widgetId) ?? new Map<string, string>();
		if (!tabs.has(tab.id) && tabs.size >= MAX_TABS_PER_WIDGET) return null;
		const page = pageSlots(tab.ui);
		if (!page) return null;
		dropTab(widgetId, tab.id);
		const id = menuTabId(widgetId, tab.id);
		const key = `tab:${id}`;
		const added = options.tabs.add(id, { label: tab.label, icon: tab.icon, order: tab.order });
		const whole = { x: 0, y: 0, ...options.pageSize };
		if (!mount(key, widgetId, page.tree, added.page, () => whole, options.pageNear, false, added.remove)) {
			added.remove();
			return null;
		}
		tabs.set(tab.id, key);
		tabsOf.set(widgetId, tabs);
		return { slots: page.slots };
	}

	function dropTab(widgetId: string, id: string): boolean {
		const tabs = tabsOf.get(widgetId);
		const key = tabs?.get(id);
		if (!tabs || !key) return false;
		tabs.delete(id);
		unmount(key);
		return true;
	}

	function removeTab(owner: string, id: string): boolean {
		const widgetId = widgetOf(owner);
		return widgetId ? dropTab(widgetId, id) : false;
	}

	const frame = scene.onBeforeRenderObservable.add(() => graph.tick(scene.getEngine().getDeltaTime() / 1000));
	const views = new Set<WidgetView>();

	return {
		view(parent, areaOf, near) {
			const grid = new Map<string, GridWidget>();
			let hidden = false;
			const start = (widget: GridWidget) => {
				if (widget.content.kind !== 'slots') return;
				const tree = widgetSlots(widget.content.tree);
				widgetByRoot.set(tree[0].id, widget.id);
				const area = () => areaOf(grid.get(widget.id) ?? widget);
				if (!mount(widgetKey(widget.id), widget.id, tree, parent, area, near, hidden)) widgetByRoot.delete(tree[0].id);
			};
			const view: WidgetView = {
				sync(next) {
					const wanted = new Map(next.filter((widget) => widget.content.kind === 'slots').map((widget) => [widget.id, widget]));
					for (const id of [...grid.keys()]) {
						if (!wanted.has(id)) { stopWidget(id); grid.delete(id); }
					}
					for (const [id, widget] of wanted) {
						// A widget id always names the same content, so only its place can have changed.
						const known = grid.has(id);
						grid.set(id, widget);
						if (!known) start(widget);
						else {
							const entry = running.get(widgetKey(id));
							if (entry) layout(entry);
						}
					}
				},
				setHidden(value) {
					hidden = value;
					for (const id of grid.keys()) {
						const entry = running.get(widgetKey(id));
						if (entry) entry.container.isVisible = !value;
					}
				},
				dispose() {
					for (const id of [...grid.keys()]) stopWidget(id);
					grid.clear();
					views.delete(view);
				}
			};
			views.add(view);
			return view;
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(frame);
			for (const view of [...views]) view.dispose();
			graph.dispose();
		}
	};
}
