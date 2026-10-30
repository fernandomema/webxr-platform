import { PointerEventTypes, type AbstractMesh, type Observer, type PointerInfo, type Scene, type TransformNode } from '@babylonjs/core';
import { Button, Control, Rectangle, StackPanel, TextBlock, type AdvancedDynamicTexture } from '@babylonjs/gui';
import { THEME } from './theme.ts';
import {
	BUILTIN_WIDGETS, addWidget, cellAt, cellRect, defaultGrid, fits, hasBuiltin, pinnedUiFrom, preferredSpan, removeWidget, shapeForSize, shapeSize,
	type BuiltinWidgetId, type Grid, type GridShape, type GridWidget, type PinnedUi
} from './dashGrid.ts';
import { gridStoreFor } from './dashGridStore.ts';
import { registerGridDropTarget } from './gridDrop.ts';
import { panelUvAt } from './panelSurface.ts';
import type { WidgetRuntime } from './dashWidgetHost.ts';

/** The room a grid keeps at its sides, and the height of the bar above it (title and editing tools). */
const SIDE_MARGIN = 20;
const HEADER_HEIGHT = 64;

/** The shortcuts of the game itself a grid may show (the Home tab's). */
export interface GridActions {
	seatedOn(): boolean;
	toggleSeated(): void;
	/** Absent where there is no inspector: its shortcut is then not offered. */
	toggleInspector?: () => void;
	exitVr(): void;
}

export interface GridViewOptions {
	/** The control the grid fills (title bar, cells and pieces of UI), and its size in px, which decides how many cells there are. */
	container: Rectangle;
	size: { width: number; height: number };
	/** Names what the grid keeps: the same id is the same grid wherever it is shown. 'home' is the Home tab's. */
	gridId: string;
	title?: string;
	actions?: GridActions;
	runtime: WidgetRuntime;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_GLYPH: Record<Corner, string> = { tl: '◤', tr: '◥', bl: '◣', br: '◢' };
const HANDLE = 28;

interface Cells {
	col: number;
	row: number;
	w: number;
	h: number;
}

/** A tile being moved or resized: where it started, where it would land, and which pointer is doing it. */
interface Drag {
	id: string;
	start: Cells;
	rect: Cells;
	/** The pointer that pressed (the laser or mouse); null until the press itself has been seen by the scene. */
	pointerId: number | null;
	/** Move: the cell of the tile the pointer holds. Resize: the cell that stays put. */
	hold: { col: number; row: number };
	corner: Corner | null;
	tile: Rectangle;
}

export interface GridView {
	/** Draws the grid again from what it holds (a setting a shortcut shows changed, the grid changed). */
	refresh(): void;
	/** Puts a piece of UI the player took out of a world on the grid, near `point` (px from the grid's corner) when given. `full` when there is no room. */
	pin(ui: PinnedUi, point?: { x: number; y: number }): 'pinned' | 'full';
	isEditing(): boolean;
	/**
	 * Shows where a piece of UI being held over the grid would land if let go now (its `panel` size is what decides how many cells it
	 * asks for), or stops showing it (null). Only while editing: that is when the grid takes pieces of UI.
	 */
	previewDrop(panel: { width: number; height: number } | null, point: { x: number; y: number } | null): void;
	/** Takes the grid down and stops its pieces of UI. */
	dispose(): void;
}

/**
 * A grid of cells the player fills with shortcuts of the game and with pieces of UI they took out of worlds: the Home tab, a custom
 * tab, a panel of a world. The pieces of UI are run and drawn by dashWidgetHost.ts inside the grid's own picture; this draws what is
 * under and around them (the shortcuts, the empty cells, the editing tools), follows the pointer while a tile is dragged, and keeps
 * the grid in its store.
 */
export function createGridView(options: GridViewOptions): GridView {
	const { container, size, gridId, title, actions, runtime } = options;
	const shape: GridShape = shapeForSize(size.width - 2 * SIDE_MARGIN, size.height - HEADER_HEIGHT);
	const store = gridStoreFor(gridId, shape);
	const gridSize = shapeSize(shape);
	let editing = false;
	let selected: string | null = null;
	let drag: Drag | null = null;
	/** The outline of where a held piece of UI would land, and the box it was drawn for. */
	let ghost: { control: Rectangle; key: string } | null = null;
	const setEditing = (on: boolean) => { editing = on; selected = null; widgets.setHidden(on); refresh(); };
	const tiles = new Map<string, Rectangle>();
	let note = '';
	let noteTimer: ReturnType<typeof setTimeout> | undefined;

	const header = new StackPanel(`grid-${gridId}-header`);
	header.isVertical = false;
	header.height = `${HEADER_HEIGHT - 8}px`;
	header.width = `${gridSize.width}px`;
	header.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	header.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	header.left = `${SIDE_MARGIN}px`;
	header.top = '6px';
	container.addControl(header);

	const place0 = (control: Control) => {
		control.width = `${gridSize.width}px`;
		control.height = `${gridSize.height}px`;
		control.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		control.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		control.left = `${SIDE_MARGIN}px`;
		control.top = `${HEADER_HEIGHT}px`;
	};
	const area = new Rectangle(`grid-${gridId}-cells`);
	area.thickness = 0;
	place0(area);
	container.addControl(area);
	// The pieces of UI, over the cells: this layer takes nothing for itself, so what is under it still answers.
	const layer = new Rectangle(`grid-${gridId}-widgets`);
	layer.thickness = 0;
	layer.isHitTestVisible = false;
	place0(layer);
	container.addControl(layer);

	// --- Where the grid is: its picture, the mesh that shows it, and its corner in it ---
	const picture = (): AdvancedDynamicTexture | null => (container.host as AdvancedDynamicTexture | undefined) ?? null;
	let surfaceMesh: AbstractMesh | null = null;
	/** The mesh the grid's picture is on (found by the texture it uses, so a grid does not have to be told). */
	function meshOfPicture(): AbstractMesh | null {
		const texture = picture();
		if (!texture) return null;
		if (surfaceMesh && !surfaceMesh.isDisposed() && surfaceMesh.material?.getActiveTextures().includes(texture)) return surfaceMesh;
		surfaceMesh = texture.getScene()?.meshes.find((mesh) => mesh.material?.getActiveTextures().includes(texture)) ?? null;
		return surfaceMesh;
	}
	const near = (): TransformNode | null => meshOfPicture();
	/** The corner of the cells in the picture (px): where the layout put the control. */
	const origin = () => {
		const measure = (area as unknown as { _currentMeasure: { left: number; top: number } })._currentMeasure;
		return { x: measure.left, y: measure.top };
	};
	const onScreen = (): boolean => {
		for (let control: Control | null = container; control; control = control.parent) if (!control.isVisible) return false;
		return Boolean(meshOfPicture()?.isEnabled());
	};

	const widgets = runtime.view(layer, (widget) => cellRect(widget), near);
	widgets.sync(store.get());

	function say(text: string): void {
		note = text;
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => { note = ''; refresh(); }, 5000);
		refresh();
	}

	function pill(name: string, text: string, width: number, background: string, onClick: () => void): Button {
		const button = Button.CreateSimpleButton(name, text);
		button.width = `${width}px`;
		button.height = '44px';
		button.color = THEME.text;
		button.background = background;
		button.fontSize = 18;
		button.cornerRadius = 10;
		button.thickness = 0;
		button.paddingRight = '6px';
		button.onPointerClickObservable.add(onClick);
		return button;
	}

	function label(text: string, width: number, size: number, color: string): TextBlock {
		const block = new TextBlock(`home-${text.slice(0, 10)}`, text);
		block.width = `${width}px`;
		block.height = '44px';
		block.fontSize = size;
		block.color = color;
		block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		block.textWrapping = true;
		block.paddingRight = '12px';
		return block;
	}

	const change = (grid: Grid): void => {
		if (!store.set(grid)) say('Could not save your Home on this device.');
	};
	const widgetById = (id: string | null): GridWidget | undefined => store.get().find((widget) => widget.id === id);

	const BUILTIN_LABELS = Object.fromEntries(BUILTIN_WIDGETS.map((item) => [item.id, item.label])) as Record<BuiltinWidgetId, string>;

	function builtinLook(id: BuiltinWidgetId): { text: string; background: string; run: () => void } | null {
		if (!actions) return null;
		if (id === 'seated') return { text: `Seated mode\n${actions.seatedOn() ? 'On' : 'Off'}`, background: actions.seatedOn() ? THEME.accent : THEME.raised, run: actions.toggleSeated };
		if (id === 'inspector') return actions.toggleInspector ? { text: 'Inspector', background: THEME.raised, run: actions.toggleInspector } : null;
		return { text: 'Exit VR', background: THEME.danger, run: actions.exitVr };
	}

	function toolbar(): void {
		if (title) header.addControl(label(title, 110, 28, THEME.text));
		if (!editing) {
			header.addControl(label(note || 'Press Edit, then let go of any UI over the grid to keep it here.', gridSize.width - (title ? 110 : 0) - 130, 18, note ? THEME.glow : THEME.muted));
			header.addControl(pill('home-edit', 'Edit', 120, THEME.surface, () => setEditing(true)));
			return;
		}
		const widget = widgetById(selected);
		if (!widget) {
			header.addControl(label(note || 'Drag a tile to move it, its corners to resize it. Let go of a UI over the grid to add it.', 520, 16, note ? THEME.glow : THEME.muted));
			for (const item of BUILTIN_WIDGETS) {
				if (!actions || hasBuiltin(store.get(), item.id) || !builtinLook(item.id)) continue;
				const added = () => { const next = addWidget(store.get(), { id: `builtin-${item.id}`, w: 2, h: 1, content: { kind: 'builtin', id: item.id } }, undefined, shape); if (next) change(next); else say('No room left on your Home.'); };
				header.addControl(pill(`home-add-${item.id}`, `+ ${item.label}`, 170, THEME.raised, added));
			}
			if (actions) header.addControl(pill('home-reset', 'Reset', 100, THEME.raised, () => { selected = null; change(defaultGrid()); }));
		} else {
			header.addControl(label(note || 'Drag it to move it, a corner to resize it.', 520, 16, note ? THEME.glow : THEME.muted));
			header.addControl(pill('home-remove', 'Remove', 120, THEME.danger, () => { selected = null; change(removeWidget(store.get(), widget.id)); }));
		}
		header.addControl(pill('home-done', 'Done', 100, THEME.go, () => setEditing(false)));
	}

	function place(control: Control, rect: { x: number; y: number; width: number; height: number }): void {
		control.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		control.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		control.left = `${rect.x}px`;
		control.top = `${rect.y}px`;
		control.width = `${rect.width}px`;
		control.height = `${rect.height}px`;
	}

	function cells(): void {
		for (let row = 0; row < shape.rows; row++) {
			for (let col = 0; col < shape.columns; col++) {
				const cell = new Rectangle(`home-cell-${col}-${row}`);
				place(cell, cellRect({ col, row, w: 1, h: 1 }));
				cell.background = THEME.surface;
				cell.thickness = 0;
				cell.cornerRadius = 10;
				cell.alpha = 0.55;
				cell.isHitTestVisible = false;
				area.addControl(cell);
			}
		}
	}

	function tile(widget: GridWidget): void {
		const rect = cellRect(widget);
		const content = widget.content;
		if (editing) {
			editTile(widget, rect);
			return;
		}
		if (content.kind === 'builtin') {
			const look = builtinLook(content.id);
			if (!look) return;
			const button = Button.CreateSimpleButton(`home-${content.id}`, look.text);
			place(button, rect);
			button.background = look.background;
			button.color = THEME.text;
			button.fontSize = 20;
			button.cornerRadius = 12;
			button.thickness = 0;
			button.onPointerClickObservable.add(look.run);
			area.addControl(button);
			return;
		}
		// A piece of UI floats over its cells (see dashWidgetHost.ts); this is the card it sits on.
		const card = new Rectangle(`home-card-${widget.id}`);
		place(card, rect);
		card.background = THEME.surface;
		card.thickness = 0;
		card.cornerRadius = 12;
		card.isHitTestVisible = false;
		area.addControl(card);
	}

	/** The cells a piece of UI of this panel size would take if let go at `point` (px from the grid's corner): null when the grid has no room. */
	function placeFor(panel: { width: number; height: number }, point?: { x: number; y: number }): Cells | null {
		const span = preferredSpan(panel, shape);
		const cell = point ? cellAt(point.x, point.y, shape) : undefined;
		const near = cell && { col: Math.max(0, cell.col - Math.floor(span.w / 2)), row: Math.max(0, cell.row - Math.floor(span.h / 2)) };
		const next = addWidget(store.get(), { id: 'preview', w: span.w, h: span.h, content: { kind: 'builtin', id: 'seated' } }, near, shape);
		const added = next?.at(-1);
		return added ? { col: added.col, row: added.row, w: added.w, h: added.h } : null;
	}

	const selectionStyle = (tile: Rectangle, on: boolean) => {
		tile.background = on ? THEME.accent : THEME.raised;
		tile.color = on ? THEME.accentBorder : THEME.border;
		tile.thickness = on ? 3 : 1;
	};

	function select(id: string | null): void {
		if (id === selected) return;
		if (selected) { const old = tiles.get(selected); if (old) selectionStyle(old, false); }
		selected = id;
		if (id) { const tile = tiles.get(id); if (tile) selectionStyle(tile, true); }
		rebuildHeader();
	}

	function editTile(widget: GridWidget, rect: { x: number; y: number; width: number; height: number }): void {
		const content = widget.content;
		const name = content.kind === 'builtin' ? BUILTIN_LABELS[content.id] : content.name;
		const tile = new Rectangle(`home-tile-${widget.id}`);
		place(tile, rect);
		tile.cornerRadius = 12;
		selectionStyle(tile, widget.id === selected);
		const text = new TextBlock(`home-tile-${widget.id}-name`, `${name}\n${widget.w}×${widget.h}`);
		text.fontSize = 18;
		text.color = THEME.text;
		text.textWrapping = true;
		text.isHitTestVisible = false;
		text.paddingLeft = text.paddingRight = `${HANDLE / 2}px`;
		tile.addControl(text);
		tile.onPointerDownObservable.add((at) => {
			if (drag) return;
			select(widget.id);
			const held = pointerCell(at.x, at.y);
			startDrag({ id: widget.id, start: current(widget), rect: current(widget), pointerId: null, hold: { col: held.col - widget.col, row: held.row - widget.row }, corner: null, tile });
		});
		for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
			const handle = new Rectangle(`home-tile-${widget.id}-${corner}`);
			handle.width = handle.height = `${HANDLE}px`;
			handle.horizontalAlignment = corner.endsWith('l') ? Control.HORIZONTAL_ALIGNMENT_LEFT : Control.HORIZONTAL_ALIGNMENT_RIGHT;
			handle.verticalAlignment = corner.startsWith('t') ? Control.VERTICAL_ALIGNMENT_TOP : Control.VERTICAL_ALIGNMENT_BOTTOM;
			handle.background = THEME.glow;
			handle.thickness = 0;
			handle.cornerRadius = 6;
			// Pressing a handle must not also pick the tile up.
			handle.isPointerBlocker = true;
			const glyph = new TextBlock(`${handle.name}-glyph`, CORNER_GLYPH[corner]);
			glyph.color = THEME.ink;
			glyph.fontSize = 18;
			glyph.isHitTestVisible = false;
			handle.addControl(glyph);
			handle.onPointerDownObservable.add(() => {
				if (drag) return;
				select(widget.id);
				// The corner opposite the one pressed stays where it is.
				const cells = current(widget);
				const hold = { col: corner.endsWith('l') ? cells.col + cells.w - 1 : cells.col, row: corner.startsWith('t') ? cells.row + cells.h - 1 : cells.row };
				startDrag({ id: widget.id, start: cells, rect: cells, pointerId: null, hold, corner, tile });
			});
			tile.addControl(handle);
		}
		tiles.set(widget.id, tile);
		area.addControl(tile);
	}

	const current = (widget: GridWidget): Cells => ({ col: widget.col, row: widget.row, w: widget.w, h: widget.h });
	const pointerCell = (textureX: number, textureY: number) => cellAt(textureX - origin().x, textureY - origin().y, shape);

	function startDrag(next: Drag): void {
		watchPointer();
		drag = next;
	}

	/** Where the grid's picture is under a pointer's hit, in its pixels. */
	function textureAt(pick: PointerInfo['pickInfo']): { x: number; y: number } | null {
		const texture = picture();
		if (!texture || !pick?.hit || pick.pickedMesh !== meshOfPicture()) return null;
		const uv = pick.getTextureCoordinates();
		const size = texture.getSize();
		return uv ? { x: uv.x * size.width, y: (1 - uv.y) * size.height } : null;
	}

	function dragTo(at: { x: number; y: number }): void {
		if (!drag) return;
		const cell = pointerCell(at.x, at.y);
		let rect: Cells;
		if (drag.corner) {
			rect = { col: Math.min(drag.hold.col, cell.col), row: Math.min(drag.hold.row, cell.row), w: Math.abs(drag.hold.col - cell.col) + 1, h: Math.abs(drag.hold.row - cell.row) + 1 };
		} else {
			const { w, h } = drag.start;
			rect = { col: Math.min(shape.columns - w, Math.max(0, cell.col - drag.hold.col)), row: Math.min(shape.rows - h, Math.max(0, cell.row - drag.hold.row)), w, h };
		}
		// A place that is taken or off the grid leaves the tile where it was last allowed.
		if (!fits(store.get(), rect, drag.id, shape)) return;
		drag.rect = rect;
		const box = cellRect(rect);
		place(drag.tile, box);
		const text = drag.tile.children[0] as TextBlock | undefined;
		if (text && drag.corner) text.text = text.text.replace(/\d+×\d+$/, `${rect.w}×${rect.h}`);
	}

	function endDrag(): void {
		const done = drag;
		drag = null;
		if (!done) return;
		const { start, rect } = done;
		if (start.col === rect.col && start.row === rect.row && start.w === rect.w && start.h === rect.h) return;
		change(store.get().map((widget) => (widget.id === done.id ? { ...widget, ...rect } : widget)));
	}

	/** Follows the pointer while a tile is dragged. Started with the first drag: until then the grid is not on a picture to ask the scene of. */
	let pointerWatch: { scene: Scene; observer: Observer<PointerInfo> } | null = null;
	function watchPointer(): void {
		const scene = picture()?.getScene();
		if (!scene || pointerWatch?.scene === scene) return;
		if (pointerWatch) pointerWatch.scene.onPointerObservable.remove(pointerWatch.observer);
		pointerWatch = { scene, observer: scene.onPointerObservable.add(onPointer) };
	}
	function onPointer(info: PointerInfo): void {
		if (!drag) return;
		const pointerId = (info.event as PointerEvent).pointerId;
		if (info.type === PointerEventTypes.POINTERDOWN) {
			// The press that picked the tile up: the pointer to follow.
			if (drag.pointerId === null) drag.pointerId = pointerId;
			return;
		}
		if (drag.pointerId !== null && pointerId !== drag.pointerId) return;
		if (info.type === PointerEventTypes.POINTERMOVE) {
			const at = textureAt(info.pickInfo);
			if (at) dragTo(at);
		} else if (info.type === PointerEventTypes.POINTERUP) {
			endDrag();
		}
	}

	function rebuildHeader(): void {
		for (const child of [...header.children]) { header.removeControl(child); child.dispose(); }
		toolbar();
	}

	function refresh(): void {
		drag = null;
		ghost = null;
		tiles.clear();
		rebuildHeader();
		for (const child of [...area.children]) { area.removeControl(child); child.dispose(); }
		if (editing) cells();
		for (const widget of store.get()) tile(widget);
	}
	const stopListening = store.onChange((grid) => {
		widgets.sync(grid);
		refresh();
	});
	refresh();

	const target = {
		isOpen: () => editing && onScreen(),
		pointAt(world: Parameters<typeof panelUvAt>[1]) {
			const mesh = meshOfPicture();
			const texture = picture();
			const uv = mesh && texture && panelUvAt(mesh, world);
			if (!uv || !texture) return null;
			const size = texture.getSize();
			const x = uv.u * size.width - origin().x;
			const y = (1 - uv.v) * size.height - origin().y;
			const margin = 40;
			return x >= -margin && y >= -margin && x <= gridSize.width + margin && y <= gridSize.height + margin ? { x, y } : null;
		},
		previewDrop: (panel: { width: number; height: number } | null, point: { x: number; y: number } | null) => view.previewDrop(panel, point),
		pinUi: (world: Parameters<typeof pinnedUiFrom>[0], slotId: string, point?: { x: number; y: number }) => {
			const ui = pinnedUiFrom(world, slotId);
			return ui ? view.pin(ui, point) : ('not-ui' as const);
		}
	};
	const stopDropping = registerGridDropTarget(target);

	const view: GridView = {
		refresh,
		isEditing: () => editing,
		previewDrop(panel, point) {
			const wanted = editing && panel && point ? placeFor(panel, point) : null;
			const key = wanted ? `${wanted.col},${wanted.row},${wanted.w},${wanted.h}` : '';
			if (!wanted) {
				if (ghost) { area.removeControl(ghost.control); ghost.control.dispose(); ghost = null; }
				return;
			}
			if (ghost?.key === key) return;
			if (!ghost) {
				const control = new Rectangle('home-drop-preview');
				control.background = THEME.accent;
				control.alpha = 0.55;
				control.color = THEME.glow;
				control.thickness = 4;
				control.cornerRadius = 12;
				control.isHitTestVisible = false;
				const plus = new TextBlock('home-drop-preview-plus', '＋');
				plus.color = THEME.text;
				plus.fontSize = 36;
				plus.isHitTestVisible = false;
				control.addControl(plus);
				area.addControl(control);
				ghost = { control, key };
			}
			place(ghost.control, cellRect(wanted));
			ghost.key = key;
		},
		dispose() {
			stopDropping();
			stopListening();
			if (pointerWatch) pointerWatch.scene.onPointerObservable.remove(pointerWatch.observer);
			widgets.dispose();
			for (const control of [header, area, layer]) {
				container.removeControl(control);
				control.dispose();
			}
		},
		pin(ui, point) {
			const spot = placeFor(ui.panel, point);
			const next = spot && addWidget(store.get(), { id: crypto.randomUUID(), w: spot.w, h: spot.h, content: { kind: 'slots', name: ui.name, panel: ui.panel, tree: ui.tree } }, { col: spot.col, row: spot.row }, shape);
			if (!next) {
				say('No room left here: remove something first.');
				return 'full';
			}
			change(next);
			say(`“${ui.name}” is kept here now.`);
			return 'pinned';
		}
	};
	return view;
}
