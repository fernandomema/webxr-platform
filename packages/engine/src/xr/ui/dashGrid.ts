import { findComponent, type Slot, type SlotTree } from '../../ecs/types.ts';
import { extractSubtree, instantiate } from '../../ecs/serialize.ts';

/**
 * A grid the player fills (the Home tab of the personal menu, a custom tab, a panel of a world): each cell span holds a shortcut of
 * the game itself or a piece of UI the player took out of a world (a panel, a button…) with its scripts. Nothing here touches
 * Babylon, so the rules (what fits, what a drop does, what is kept) are tested in Node. See dashGridStore.ts for where it is kept,
 * dashWidgetHost.ts for how the pieces of UI are run and gridView.ts for how a grid is drawn and edited.
 */

/** How many cells a grid has: it follows the size of the control that holds it (see `shapeForSize`). */
export interface GridShape {
	columns: number;
	rows: number;
}

/** The Home tab's grid. */
export const HOME_SHAPE: GridShape = { columns: 12, rows: 4 };
export const GRID_COLUMNS = HOME_SHAPE.columns;
export const GRID_ROWS = HOME_SHAPE.rows;
/** What a grid may keep, so a long-lived menu cannot grow without bound. */
export const MAX_WIDGETS = 40;
export const MAX_WIDGET_BYTES = 256 * 1024;

export type BuiltinWidgetId = 'seated' | 'inspector' | 'exit-vr';
export const BUILTIN_WIDGETS: readonly { id: BuiltinWidgetId; label: string }[] = [
	{ id: 'seated', label: 'Seated mode' },
	{ id: 'inspector', label: 'Inspector' },
	{ id: 'exit-vr', label: 'Exit VR' }
];

export type WidgetContent =
	| { kind: 'builtin'; id: BuiltinWidgetId }
	/** A piece of UI from a world: a tree whose root carries a `uiPanel`. `panel` is that panel's size, for fitting it to its cells. */
	| { kind: 'slots'; name: string; panel: { width: number; height: number }; tree: SlotTree };

export interface GridWidget {
	id: string;
	/** The top-left cell and how many cells it covers. */
	col: number;
	row: number;
	w: number;
	h: number;
	content: WidgetContent;
}

export type Grid = GridWidget[];

export const defaultGrid = (): Grid =>
	BUILTIN_WIDGETS.map((widget, index) => ({ id: `builtin-${widget.id}`, col: index * 2, row: 0, w: 2, h: 1, content: { kind: 'builtin', id: widget.id } }));

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function overlaps(a: Pick<GridWidget, 'col' | 'row' | 'w' | 'h'>, b: Pick<GridWidget, 'col' | 'row' | 'w' | 'h'>): boolean {
	return a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
}

const inside = (r: Pick<GridWidget, 'col' | 'row' | 'w' | 'h'>, shape: GridShape) => r.w >= 1 && r.h >= 1 && r.col >= 0 && r.row >= 0 && r.col + r.w <= shape.columns && r.row + r.h <= shape.rows;

/** Whether `rect` is on the grid and clear of every widget but `ignore`. */
export function fits(grid: Grid, rect: Pick<GridWidget, 'col' | 'row' | 'w' | 'h'>, ignore?: string, shape: GridShape = HOME_SHAPE): boolean {
	return inside(rect, shape) && !grid.some((widget) => widget.id !== ignore && overlaps(widget, rect));
}

function isPanel(value: unknown): value is { width: number; height: number } {
	const panel = value as { width?: unknown; height?: unknown } | null;
	return !!panel && typeof panel.width === 'number' && typeof panel.height === 'number' && panel.width > 0 && panel.height > 0 && panel.width <= 8192 && panel.height <= 8192;
}

/** A saved grid made safe to use: unknown or broken widgets dropped, each one on the grid, none on top of another, the first kept. */
export function normalizeGrid(saved: unknown, shape: GridShape = HOME_SHAPE, fallback: () => Grid = defaultGrid): Grid {
	if (!Array.isArray(saved)) return fallback();
	const grid: Grid = [];
	const ids = new Set<string>();
	for (const raw of saved) {
		if (grid.length >= MAX_WIDGETS) break;
		const widget = raw as Partial<GridWidget> | null;
		if (!widget || typeof widget.id !== 'string' || !widget.id || ids.has(widget.id) || !widget.content) continue;
		if (!isInt(widget.col) || !isInt(widget.row) || !isInt(widget.w) || !isInt(widget.h)) continue;
		const rect = { col: widget.col, row: widget.row, w: widget.w, h: widget.h };
		if (!fits(grid, rect, undefined, shape)) continue;
		const content = widget.content;
		if (content.kind === 'builtin') {
			if (!BUILTIN_WIDGETS.some((item) => item.id === content.id)) continue;
			grid.push({ id: widget.id, ...rect, content: { kind: 'builtin', id: content.id } });
		} else if (content.kind === 'slots') {
			if (!Array.isArray(content.tree) || content.tree.length === 0 || !isPanel(content.panel) || typeof content.name !== 'string') continue;
			if (!content.tree[0] || !findComponent(content.tree[0], 'uiPanel')) continue;
			grid.push({ id: widget.id, ...rect, content: { kind: 'slots', name: content.name.slice(0, 80), panel: { width: content.panel.width, height: content.panel.height }, tree: content.tree } });
		} else continue;
		ids.add(widget.id);
	}
	return grid;
}

/** The first free place for a `w`×`h` widget, searching rows then columns from `near` (a cell) when given, else from the top left. */
export function findFreeSpot(grid: Grid, w: number, h: number, near?: { col: number; row: number }, shape: GridShape = HOME_SHAPE): { col: number; row: number } | null {
	let best: { col: number; row: number; distance: number } | null = null;
	for (let row = 0; row + h <= shape.rows; row++) {
		for (let col = 0; col + w <= shape.columns; col++) {
			if (!fits(grid, { col, row, w, h }, undefined, shape)) continue;
			const distance = near ? Math.abs(col - near.col) + Math.abs(row - near.row) : row * shape.columns + col;
			if (!best || distance < best.distance) best = { col, row, distance };
		}
	}
	return best && { col: best.col, row: best.row };
}

/**
 * Adds a widget at `near` (or the first free place). When it does not fit as asked it is made smaller: the largest size that has
 * a free place, and among those the one closest to its own shape. Null when the grid is full.
 */
export function addWidget(grid: Grid, widget: Omit<GridWidget, 'col' | 'row'>, near?: { col: number; row: number }, shape: GridShape = HOME_SHAPE): Grid | null {
	if (grid.length >= MAX_WIDGETS) return null;
	const wanted = { w: Math.min(widget.w, shape.columns), h: Math.min(widget.h, shape.rows) };
	const sizes: { w: number; h: number }[] = [];
	for (let w = wanted.w; w >= 1; w--) for (let h = wanted.h; h >= 1; h--) sizes.push({ w, h });
	const aspect = (size: { w: number; h: number }) => Math.abs(Math.log(size.w / size.h) - Math.log(wanted.w / wanted.h));
	sizes.sort((a, b) => b.w * b.h - a.w * a.h || aspect(a) - aspect(b));
	for (const size of sizes) {
		const spot = findFreeSpot(grid, size.w, size.h, near, shape);
		if (spot) return [...grid, { ...widget, ...spot, ...size }];
	}
	return null;
}

export function removeWidget(grid: Grid, id: string): Grid {
	return grid.filter((widget) => widget.id !== id);
}

/** Moves a widget by whole cells; unchanged when it would leave the grid or land on another. */
export function moveWidget(grid: Grid, id: string, dCol: number, dRow: number, shape: GridShape = HOME_SHAPE): Grid {
	const widget = grid.find((candidate) => candidate.id === id);
	if (!widget) return grid;
	const next = { col: widget.col + dCol, row: widget.row + dRow, w: widget.w, h: widget.h };
	return fits(grid, next, id, shape) ? grid.map((candidate) => (candidate.id === id ? { ...candidate, ...next } : candidate)) : grid;
}

/** Grows or shrinks a widget by whole cells (at least 1×1); unchanged when it would not fit. */
export function resizeWidget(grid: Grid, id: string, dW: number, dH: number, shape: GridShape = HOME_SHAPE): Grid {
	const widget = grid.find((candidate) => candidate.id === id);
	if (!widget) return grid;
	const next = { col: widget.col, row: widget.row, w: widget.w + dW, h: widget.h + dH };
	return fits(grid, next, id, shape) ? grid.map((candidate) => (candidate.id === id ? { ...candidate, ...next } : candidate)) : grid;
}

/** Whether a builtin shortcut is already on the grid. */
export const hasBuiltin = (grid: Grid, id: BuiltinWidgetId): boolean => grid.some((widget) => widget.content.kind === 'builtin' && widget.content.id === id);

// --- Geometry ---

/** Cell size and gap, in the Home page's pixels; the page is `GRID_COLUMNS` of them wide. */
export const CELL = 96;
export const CELL_GAP = 8;
export const CELL_PITCH = CELL + CELL_GAP;
export const GRID_WIDTH = GRID_COLUMNS * CELL_PITCH - CELL_GAP;
export const GRID_HEIGHT = GRID_ROWS * CELL_PITCH - CELL_GAP;

/** The cells that fit in a box of `width`×`height` px (at least one). */
export function shapeForSize(width: number, height: number): GridShape {
	return { columns: Math.max(1, Math.floor((width + CELL_GAP) / CELL_PITCH)), rows: Math.max(1, Math.floor((height + CELL_GAP) / CELL_PITCH)) };
}

/** The pixels a grid of this shape covers. */
export const shapeSize = (shape: GridShape): { width: number; height: number } => ({ width: shape.columns * CELL_PITCH - CELL_GAP, height: shape.rows * CELL_PITCH - CELL_GAP });

/** The pixels a widget covers, from the grid's top-left corner. */
export function cellRect(widget: Pick<GridWidget, 'col' | 'row' | 'w' | 'h'>): { x: number; y: number; width: number; height: number } {
	return { x: widget.col * CELL_PITCH, y: widget.row * CELL_PITCH, width: widget.w * CELL_PITCH - CELL_GAP, height: widget.h * CELL_PITCH - CELL_GAP };
}

/** The cell under a point (pixels from the grid's top-left corner), clamped onto the grid. */
export function cellAt(x: number, y: number, shape: GridShape = HOME_SHAPE): { col: number; row: number } {
	return {
		col: Math.min(shape.columns - 1, Math.max(0, Math.floor(x / CELL_PITCH))),
		row: Math.min(shape.rows - 1, Math.max(0, Math.floor(y / CELL_PITCH)))
	};
}

/**
 * How a panel of `panel` design pixels sits in a box of `width`×`height`: as large as fits with its shape kept, centred. `scale` is
 * box pixels per design pixel.
 */
export function fitPanel(panel: { width: number; height: number }, box: { width: number; height: number }): { scale: number; width: number; height: number; x: number; y: number } {
	const scale = Math.min(box.width / panel.width, box.height / panel.height);
	const width = panel.width * scale;
	const height = panel.height * scale;
	return { scale, width, height, x: (box.width - width) / 2, y: (box.height - height) / 2 };
}

/** How many cells a new panel of `panel` design pixels asks for: about its own size at a readable scale, never more than the grid. */
export function preferredSpan(panel: { width: number; height: number }, shape: GridShape = HOME_SHAPE): { w: number; h: number } {
	const scale = 0.5; // a panel is drawn at about half its design pixels
	const w = Math.round((panel.width * scale + CELL_GAP) / CELL_PITCH);
	const h = Math.round((panel.height * scale + CELL_GAP) / CELL_PITCH);
	return { w: Math.min(shape.columns, Math.max(1, w)), h: Math.min(shape.rows, Math.max(1, h)) };
}

// --- Taking UI out of a world ---

export interface PinnedUi {
	name: string;
	panel: { width: number; height: number };
	tree: SlotTree;
}

const DEFAULT_ELEMENT_PANEL = { width: 360, height: 120 };

/**
 * The UI a player grabbed, as something to keep: `slotId` is a panel (a slot with `uiPanel`), or a control inside one (then it
 * goes in a panel of its own, so it works the same wherever it is put). The copy has fresh ids, no ties to the world's slots, and
 * nothing of where it stood. Null when what was grabbed is not UI, or is too large to keep.
 */
export function pinnedUiFrom(world: SlotTree, slotId: string): PinnedUi | null {
	const root = world.find((slot) => slot.id === slotId);
	if (!root) return null;
	const byId = new Map(world.map((slot) => [slot.id, slot]));
	let panelId: string | null = null;
	for (let at: Slot | undefined = root; at; at = at.parentId ? byId.get(at.parentId) : undefined) {
		if (findComponent(at, 'uiPanel')) {
			panelId = at.id;
			break;
		}
	}
	let tree: SlotTree;
	let panel: { width: number; height: number };
	let name = root.name;
	if (panelId === root.id) {
		tree = extractSubtree(world, root.id);
		const component = findComponent(tree[0], 'uiPanel')!;
		panel = { width: component.width, height: component.height };
	} else if (panelId) {
		// A control (or a group of them) of a panel: it keeps the panel's look in a panel just its size.
		const owner = byId.get(panelId)!;
		const ownerPanel = findComponent(owner, 'uiPanel')!;
		const element = findComponent(root, 'uiElement');
		if (!element) return null;
		const sub = extractSubtree(world, root.id);
		const width = Math.min(ownerPanel.width, element.width ?? DEFAULT_ELEMENT_PANEL.width);
		const height = Math.min(ownerPanel.height, element.height ?? DEFAULT_ELEMENT_PANEL.height);
		panel = { width: Math.max(80, width), height: Math.max(48, height) };
		const wrapper: Slot = {
			id: crypto.randomUUID(), parentId: null, name: root.name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
			components: [{ ...ownerPanel, width: panel.width, height: panel.height }]
		};
		tree = [wrapper, ...sub.map((slot, index) => (index === 0 ? { ...slot, parentId: wrapper.id } : slot))];
	} else return null;
	const copy = instantiate(tree).map((slot, index) => (index === 0 ? { ...slot, position: [0, 0, 0] as Slot['position'], rotation: [0, 0, 0, 1] as Slot['rotation'], scale: [1, 1, 1] as Slot['scale'] } : slot));
	// On the menu a panel is seen from its front, whichever way it was mounted in its world: a mirror made for that mounting would show it reversed.
	for (const slot of copy) slot.components = slot.components.map((component) => (component.type === 'uiPanel' && component.mirrorX ? { ...component, mirrorX: false } : component));
	if (JSON.stringify(copy).length > MAX_WIDGET_BYTES) return null;
	return { name, panel, tree: copy };
}

/** The slots of a pinned piece of UI to run, with a fresh id each, so that two copies of one widget never share one. */
export const widgetSlots = (tree: SlotTree): SlotTree => instantiate(tree);
