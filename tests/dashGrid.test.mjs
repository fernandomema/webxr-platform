import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	GRID_COLUMNS, GRID_ROWS, MAX_WIDGETS, addWidget, cellAt, cellRect, defaultGrid, findFreeSpot, fitPanel, fits, moveWidget,
	normalizeGrid, pinnedUiFrom, preferredSpan, removeWidget, resizeWidget, CELL_PITCH, GRID_WIDTH, HOME_SHAPE, shapeForSize, shapeSize
} from '../packages/engine/src/xr/ui/dashGrid.ts';
import { createDashGridStore, gridStoreFor } from '../packages/engine/src/xr/ui/dashGridStore.ts';

const slot = (id, parentId, components = [], name = id) => ({ id, parentId, name, position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });
const panelSlot = (id, width = 640, height = 400) => slot(id, null, [{ type: 'uiPanel', width, height }]);
const element = (id, parentId, extra = {}) => slot(id, parentId, [{ type: 'uiElement', kind: 'button', ...extra }, { type: 'codeBlock', code: 'export default {}' }]);
const widget = (id, col, row, w = 1, h = 1) => ({ id, col, row, w, h, content: { kind: 'builtin', id: 'seated' } });

test('the default grid holds the three shortcuts side by side and is valid as it stands', () => {
	const grid = defaultGrid();
	assert.equal(grid.length, 3);
	assert.deepEqual(normalizeGrid(grid), grid);
});

test('normalizing drops what is broken, off the grid or on top of another, and keeps the first', () => {
	const grid = normalizeGrid([
		widget('a', 0, 0, 2, 2),
		widget('b', 1, 1), // on top of a
		widget('c', GRID_COLUMNS - 1, 0, 2, 1), // off the right edge
		{ ...widget('d', 0, 3), content: { kind: 'builtin', id: 'nope' } },
		{ ...widget('a', 5, 0) }, // repeated id
		{ id: 'e', col: 1.5, row: 0, w: 1, h: 1, content: { kind: 'builtin', id: 'seated' } },
		widget('f', 4, 3)
	]);
	assert.deepEqual(grid.map((w) => w.id), ['a', 'f']);
	assert.equal(normalizeGrid('junk').length, 3, 'unreadable data gives the default grid');
	assert.equal(normalizeGrid(Array.from({ length: 100 }, (_, i) => widget(`w${i}`, i % GRID_COLUMNS, Math.floor(i / GRID_COLUMNS) % GRID_ROWS))).length <= MAX_WIDGETS, true);
});

test('a widget of slots needs a panel root', () => {
	const good = { id: 'u', col: 0, row: 0, w: 3, h: 2, content: { kind: 'slots', name: 'Mixer', panel: { width: 640, height: 400 }, tree: [panelSlot('p')] } };
	const bad = { ...good, id: 'v', col: 4, content: { ...good.content, tree: [slot('p', null)] } };
	assert.deepEqual(normalizeGrid([good, bad]).map((w) => w.id), ['u']);
});

test('adding puts a widget at the spot asked for, else the nearest free one, and shrinks it to find room', () => {
	let grid = addWidget([], widget('a', 0, 0, 2, 1));
	assert.deepEqual([grid[0].col, grid[0].row], [0, 0]);
	grid = addWidget(grid, widget('b', 0, 0, 2, 1), { col: 1, row: 0 });
	assert.equal(fits(grid.slice(0, 1), grid[1]), true);
	assert.deepEqual([grid[1].col, grid[1].row], [2, 0], 'the free spot closest to where it was dropped');
	assert.equal(findFreeSpot(grid, GRID_COLUMNS, GRID_ROWS), null);
	// Only a 1-row gap is left: a tall widget gives up height to fit.
	let tight = [];
	for (let row = 0; row < GRID_ROWS - 1; row++) tight = addWidget(tight, widget(`r${row}`, 0, 0, GRID_COLUMNS, 1));
	const squeezed = addWidget(tight, widget('big', 0, 0, 4, 3));
	assert.equal(squeezed.at(-1).h, 1);
	assert.equal(squeezed.at(-1).w, 4, 'the shape is kept as far as it can be');
	// Full grid: nothing fits.
	assert.equal(addWidget(squeezed.slice(0, tight.length).concat(widget('fill', 0, GRID_ROWS - 1, GRID_COLUMNS, 1)), widget('x', 0, 0)), null);
});

test('move and resize happen by cells, and refuse to leave the grid or land on another', () => {
	const grid = [widget('a', 0, 0, 2, 1), widget('b', 2, 0, 2, 1)];
	assert.equal(moveWidget(grid, 'a', 1, 0), grid, 'onto b');
	assert.equal(moveWidget(grid, 'a', -1, 0), grid, 'off the left');
	assert.deepEqual(moveWidget(grid, 'a', 0, 1)[0], { ...grid[0], row: 1 });
	assert.equal(resizeWidget(grid, 'a', 1, 0), grid, 'into b');
	assert.equal(resizeWidget(grid, 'a', -1, 0)[0].w, 1);
	assert.equal(resizeWidget(grid, 'a', -2, 0), grid, 'never below 1x1');
	assert.equal(removeWidget(grid, 'a').length, 1);
});

test('cells map to pixels and back, and a panel is fitted to its cells keeping its shape', () => {
	assert.deepEqual(cellRect({ col: 1, row: 2, w: 2, h: 1 }), { x: CELL_PITCH, y: 2 * CELL_PITCH, width: 2 * CELL_PITCH - 8, height: CELL_PITCH - 8 });
	assert.deepEqual(cellAt(CELL_PITCH + 5, 3), { col: 1, row: 0 });
	assert.deepEqual(cellAt(-50, 99999), { col: 0, row: GRID_ROWS - 1 });
	assert.equal(GRID_WIDTH, GRID_COLUMNS * CELL_PITCH - 8);
	const fitted = fitPanel({ width: 640, height: 400 }, { width: 320, height: 320 });
	assert.equal(fitted.scale, 0.5);
	assert.deepEqual([fitted.width, fitted.height, fitted.x, fitted.y], [320, 200, 0, 60]);
	const span = preferredSpan({ width: 640, height: 400 });
	assert.ok(span.w >= 2 && span.w <= GRID_COLUMNS && span.h >= 1 && span.h <= GRID_ROWS);
	assert.deepEqual(preferredSpan({ width: 99999, height: 99999 }), { w: GRID_COLUMNS, h: GRID_ROWS });
});

test('a grabbed panel is copied whole, with fresh ids and no place of its own', () => {
	const world = [panelSlot('p'), element('b1', 'p'), element('b2', 'p'), slot('other', null)];
	const pinned = pinnedUiFrom(world, 'p');
	assert.equal(pinned.tree.length, 3);
	assert.deepEqual(pinned.panel, { width: 640, height: 400 });
	assert.ok(pinned.tree.every((s) => !world.some((w) => w.id === s.id)), 'fresh ids');
	assert.equal(pinned.tree[0].parentId, null);
	assert.deepEqual(pinned.tree[0].position, [0, 0, 0]);
	assert.equal(pinned.tree[1].parentId, pinned.tree[0].id);
	assert.ok(pinned.tree[1].components.some((c) => c.type === 'codeBlock'), 'its script comes with it');
});

test('a grabbed control goes into a panel of its own, keeping the look of the panel it was in', () => {
	const world = [{ ...panelSlot('p'), components: [{ type: 'uiPanel', width: 640, height: 400, background: '#123456' }] }, element('row', 'p', { kind: 'container', height: 60 }), element('b', 'row')];
	const pinned = pinnedUiFrom(world, 'row');
	assert.equal(pinned.tree.length, 3, 'a wrapper panel, the row and its button');
	assert.equal(pinned.tree[0].components[0].type, 'uiPanel');
	assert.equal(pinned.tree[0].components[0].background, '#123456');
	assert.equal(pinned.panel.height, 60);
	assert.equal(pinned.tree[1].parentId, pinned.tree[0].id);
	assert.equal(pinnedUiFrom(world, 'nothing'), null);
	assert.equal(pinnedUiFrom([slot('plain', null)], 'plain'), null, 'not UI');
});

test('the grid is kept between sessions, and what cannot be read is the default grid', () => {
	const data = new Map();
	const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
	const store = createDashGridStore(storage);
	assert.equal(store.get().length, 3);
	let heard = 0;
	store.onChange(() => heard++);
	assert.equal(store.set([widget('a', 3, 2, 2, 2)]), true);
	assert.equal(heard, 1);
	assert.deepEqual(createDashGridStore(storage).get().map((w) => [w.id, w.col, w.row]), [['a', 3, 2]]);
	data.set([...data.keys()][0], '{broken');
	assert.equal(createDashGridStore(storage).get().length, 3);
	const full = createDashGridStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
	assert.equal(full.set([]), false, 'reports it was not kept');
	assert.deepEqual(full.get(), [], 'but holds for this session');
});

test('a panel mounted mirrored in its world is kept unmirrored: the menu shows it from the front', () => {
	const world = [{ ...panelSlot('p'), components: [{ type: 'uiPanel', width: 640, height: 400, mirrorX: true }] }, element('b', 'p')];
	assert.equal(pinnedUiFrom(world, 'p').tree[0].components[0].mirrorX, false);
	assert.equal(world[0].components[0].mirrorX, true, 'the world keeps its own');
});

test('a grid has as many cells as its box holds, and every rule follows its shape', () => {
	assert.deepEqual(shapeForSize(1240, 408), HOME_SHAPE, 'the Home grid is the 12 x 4 it always was');
	assert.deepEqual(shapeForSize(1, 1), { columns: 1, rows: 1 }, 'never fewer than a cell');
	const small = shapeForSize(420, 200);
	assert.deepEqual(small, { columns: 4, rows: 2 });
	assert.deepEqual(shapeSize(small), { width: 4 * CELL_PITCH - 8, height: 2 * CELL_PITCH - 8 });
	assert.equal(fits([], { col: 3, row: 1, w: 1, h: 1 }, undefined, small), true);
	assert.equal(fits([], { col: 4, row: 0, w: 1, h: 1 }, undefined, small), false, 'off a small grid, on the big one');
	assert.equal(fits([], { col: 4, row: 0, w: 1, h: 1 }), true);
	assert.deepEqual(cellAt(9999, 9999, small), { col: 3, row: 1 });
	assert.deepEqual(preferredSpan({ width: 99999, height: 99999 }, small), { w: 4, h: 2 });
	assert.equal(addWidget([], widget('a', 0, 0, 8, 8), undefined, small).at(-1).w, 4, 'a widget is shrunk to a small grid');
	assert.deepEqual(normalizeGrid([widget('a', 5, 0), widget('b', 1, 0)], small, () => []).map((w) => w.id), ['b']);
	assert.deepEqual(normalizeGrid('junk', small, () => []), [], 'a grid that is not Home starts empty');
});

test('each grid is kept under its own id, and Home keeps its old place', () => {
	const data = new Map();
	const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
	const tab = createDashGridStore(storage, 'tab:one', shapeForSize(420, 200));
	assert.deepEqual(tab.get(), [], 'a new grid is empty');
	tab.set([widget('a', 1, 1)]);
	createDashGridStore(storage, 'home').set([widget('h', 0, 0)]);
	assert.deepEqual([...data.keys()].sort(), ['webxr-platform-dash-grid', 'webxr-platform-grid:tab:one']);
	assert.deepEqual(createDashGridStore(storage, 'tab:one', shapeForSize(420, 200)).get().map((w) => w.id), ['a']);
	assert.equal(gridStoreFor('same'), gridStoreFor('same'), 'one store per id, shared by every place that shows it');
	assert.notEqual(gridStoreFor('same'), gridStoreFor('other'));
});
