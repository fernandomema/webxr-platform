import assert from 'node:assert/strict';
import test from 'node:test';
import { FACET_ENTRIES, FACETS_FOLDER } from '../src/lib/content/starterKit/facets.ts';
import { BUILTIN_FOLDERS, BUILTIN_ENTRIES } from '../src/lib/content/starterKit/catalog.ts';
import { findComponent } from '../packages/engine/src/ecs/types.ts';
import { layoutUiTree } from '../packages/engine/src/xr/uiLayout.ts';
import { pinnedUiFrom, normalizeGrid, preferredSpan, addWidget } from '../packages/engine/src/xr/ui/dashGrid.ts';

test('the facets are in the starter kit, in a folder of their own', () => {
	assert.ok(BUILTIN_FOLDERS.some((folder) => folder.id === FACETS_FOLDER.id));
	for (const entry of FACET_ENTRIES) {
		assert.equal(entry.folderId, 'facets');
		assert.ok(BUILTIN_ENTRIES.some((candidate) => candidate.id === entry.id), entry.name);
	}
	assert.equal(new Set(FACET_ENTRIES.map((entry) => entry.id)).size, FACET_ENTRIES.length);
});

for (const entry of FACET_ENTRIES) {
	test(`${entry.name}: a panel whose elements fit and whose script compiles`, () => {
		const tree = entry.build();
		const panel = findComponent(tree[0], 'uiPanel');
		assert.ok(panel, 'the root is a UI panel');
		assert.ok(tree.every((slot) => slot.id === tree[0].id || tree.some((parent) => parent.id === slot.parentId)), 'every element hangs from something');
		const nodes = tree.slice(1).map((slot) => ({ id: slot.id, parentId: slot.parentId === tree[0].id ? null : slot.parentId, component: findComponent(slot, 'uiElement') }));
		assert.ok(nodes.every((node) => node.component), 'elements are uiElements');
		assert.deepEqual(layoutUiTree(nodes, panel).issues, [], 'nothing is cut off');
		const code = findComponent(tree[0], 'codeBlock').code;
		assert.doesNotThrow(() => new Function('ctx', code), 'the script is valid');
		// Names are how a script finds its elements, so they are unique inside the panel.
		const names = tree.slice(1).map((slot) => slot.name);
		assert.equal(new Set(names).size, names.length);
		// It can be kept on the Home grid as it is, and asks for a sensible place.
		const pinned = pinnedUiFrom(tree, tree[0].id);
		assert.ok(pinned, 'it can be pinned');
		const span = preferredSpan(pinned.panel);
		assert.ok(span.w >= 1 && span.h >= 1 && span.w * span.h <= 8);
		const grid = addWidget([], { id: 'w', w: span.w, h: span.h, content: { kind: 'slots', name: pinned.name, panel: pinned.panel, tree: pinned.tree } });
		assert.equal(normalizeGrid(grid).length, 1, 'and what is saved is read back');
	});
}

test('every build is a fresh copy, so one facet pinned twice shares nothing', () => {
	const a = FACET_ENTRIES[0].build();
	a[0].name = 'changed';
	assert.notEqual(FACET_ENTRIES[0].build()[0].name, 'changed');
});

test('the extra tab facet adds a tab whose page holds a grid kept under the piece\'s own name', () => {
	const entry = FACET_ENTRIES.find((candidate) => candidate.id === 'facet-extra-tab');
	const code = findComponent(entry.build()[0], 'codeBlock').code;
	const added = [];
	const ctx = { dash: { instanceId: () => 'inst-7', addTab: (tab) => { added.push(tab); return { slots: {} }; }, showTab() {} }, hierarchy: { getChildren: () => [] }, self: { id: 'x' }, world: {} };
	new Function('ctx', code)(ctx);
	assert.equal(added.length, 1);
	const page = added[0].ui;
	assert.equal(findComponent(page[0], 'uiPanel').width, 1280);
	const grid = findComponent(page[1], 'uiElement');
	assert.equal(grid.kind, 'grid');
	assert.equal(grid.gridId, 'extra-tab:inst-7');
	const nodes = page.slice(1).map((slot) => ({ id: slot.id, parentId: slot.parentId === 'page' ? null : slot.parentId, component: findComponent(slot, 'uiElement') }));
	assert.deepEqual(layoutUiTree(nodes, findComponent(page[0], 'uiPanel')).issues, [], 'the grid fits the page');
	const none = [];
	new Function('ctx', code)({ ...ctx, dash: { ...ctx.dash, instanceId: () => null, addTab: (tab) => none.push(tab) } });
	assert.equal(none.length, 0, 'outside the menu there is nothing to key the grid by, so no tab');
});
