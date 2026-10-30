import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRegistry, tabBarLayout, tabBarPaging, DEFAULT_TAB_ORDER } from '../packages/engine/src/xr/ui/dashTabs.ts';

const ids = (registry) => registry.list().map((tab) => tab.id);

test('tabs are listed by order, and by when they were added among equals', () => {
	const registry = new TabRegistry();
	registry.add({ id: 'late', label: 'Late' });
	registry.add({ id: 'b', label: 'B', order: 20 });
	registry.add({ id: 'a', label: 'A', order: 10 });
	registry.add({ id: 'b2', label: 'B2', order: 20 });
	assert.deepEqual(ids(registry), ['a', 'b', 'b2', 'late']);
	assert.equal(DEFAULT_TAB_ORDER, 1000);
});

test('adding a tab with an existing id replaces it in place', () => {
	const registry = new TabRegistry();
	registry.add({ id: 'x', label: 'One' });
	registry.add({ id: 'y', label: 'Y' });
	registry.add({ id: 'x', label: 'Two' });
	assert.deepEqual(ids(registry), ['x', 'y']);
	assert.equal(registry.get('x').label, 'Two');
});

test('the function returned by add removes that tab, but not one that replaced it', () => {
	const registry = new TabRegistry();
	const removeFirst = registry.add({ id: 'x', label: 'One' });
	registry.add({ id: 'x', label: 'Two' });
	removeFirst();
	assert.equal(registry.has('x'), true);
	const removeThird = registry.add({ id: 'z', label: 'Z' });
	removeThird();
	assert.equal(registry.has('z'), false);
});

test('remove reports whether there was a tab, and listeners hear about every change', () => {
	const registry = new TabRegistry();
	let calls = 0;
	const stop = registry.onChange(() => calls++);
	registry.add({ id: 'x', label: 'X' });
	assert.equal(registry.remove('x'), true);
	assert.equal(registry.remove('x'), false);
	assert.equal(calls, 2);
	stop();
	registry.add({ id: 'y', label: 'Y' });
	assert.equal(calls, 2);
});

test('tab buttons keep their full width while there is room, then narrow, then drop their labels', () => {
	assert.deepEqual(tabBarLayout(6, 980), { width: 156, showLabels: true });
	assert.deepEqual(tabBarLayout(3, 980), { width: 160, showLabels: true });
	const narrow = tabBarLayout(9, 980);
	assert.equal(narrow.showLabels, false);
	assert.ok(narrow.width >= 56 && narrow.width < 112);
	assert.equal(tabBarLayout(40, 980).width, 56);
});

test('icons are drawn as SVG data URIs in the colour asked for, and unknown ones are not', async () => {
	const { iconUri, hasIcon, registerIcon } = await import('../packages/engine/src/xr/ui/icons.ts');
	assert.equal(hasIcon('house'), true);
	const uri = iconUri('house', '#ff7a45', 32);
	assert.match(uri, /^data:image\/svg\+xml/);
	const svg = decodeURIComponent(uri.split(',')[1]);
	assert.ok(svg.includes('#ff7a45') && !svg.includes('currentColor') && svg.includes('width="32"'));
	assert.equal(iconUri('nope', '#fff'), undefined);
	registerIcon('mine', '<circle cx="12" cy="12" r="8" fill="currentColor"/>');
	assert.ok(decodeURIComponent(iconUri('mine', '#123456').split(',')[1]).includes('fill="#123456"'));
});

test('the tab bar pages itself once the tabs no longer fit with their labels', () => {
	assert.deepEqual(tabBarPaging(6, 1220, { gap: 10 }), { perPage: 6, pages: 1, paged: false });
	assert.equal(tabBarPaging(0, 1220).paged, false);
	const many = tabBarPaging(30, 1220, { gap: 10 });
	assert.equal(many.paged, true);
	assert.ok(many.perPage >= 8 && many.perPage * many.pages >= 30 && (many.pages - 1) * many.perPage < 30);
	// The buttons that turn the page take room, so a page holds fewer than the bar would without them.
	const fits = tabBarPaging(11, 1220, { gap: 10 });
	assert.equal(fits.paged, false);
	assert.equal(tabBarPaging(12, 1220, { gap: 10 }).paged, true);
	assert.equal(tabBarPaging(3, 100).perPage >= 1, true);
});

test('the player\'s order puts their tabs first as they placed them, and a tab added since goes last', async () => {
	const { applyTabOrder, moveTab, mergeShownOrder, orderToKeep, loadTabOrder, saveTabOrder } = await import('../packages/engine/src/xr/ui/tabOrder.ts');
	const tabs = ['home', 'session', 'worlds', 'inventory'].map((id) => ({ id }));
	assert.deepEqual(applyTabOrder(tabs, []).map((t) => t.id), ['home', 'session', 'worlds', 'inventory'], 'nothing placed: as they ask');
	assert.deepEqual(applyTabOrder(tabs, ['inventory', 'home', 'gone']).map((t) => t.id), ['inventory', 'home', 'session', 'worlds'], 'unknown ids are ignored, others keep their order after');
	assert.deepEqual(moveTab(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
	assert.deepEqual(moveTab(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
	assert.deepEqual(moveTab(['a', 'b'], 'a', 99), ['b', 'a'], 'clamped');
	assert.deepEqual(moveTab(['a', 'b'], 'x', 0), ['a', 'b']);
	// A page of the bar shows only some tabs: reordering them leaves the others where they are.
	assert.deepEqual(mergeShownOrder(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], ['d', 'b']), ['a', 'd', 'c', 'b', 'e']);
	assert.deepEqual(orderToKeep(['b', 'a'], ['a', 'x', 'b', 'y']), ['b', 'a', 'x', 'y'], 'tabs not here now keep a place for when they return');
	const data = new Map();
	const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
	assert.deepEqual(loadTabOrder(storage), []);
	assert.equal(saveTabOrder(['b', 'a', 'b'], storage), true);
	assert.deepEqual(loadTabOrder(storage), ['b', 'a'], 'read back without repeats');
	data.set([...data.keys()][0], '{broken');
	assert.deepEqual(loadTabOrder(storage), []);
	assert.equal(saveTabOrder(['a'], { getItem: () => null, setItem: () => { throw new Error('quota'); } }), false);
});

test('a registry shows the order the player set, and goes back to its own when it is cleared', () => {
	const registry = new TabRegistry();
	registry.add({ id: 'a', label: 'A', order: 0 });
	registry.add({ id: 'b', label: 'B', order: 10 });
	registry.add({ id: 'c', label: 'C', order: 20 });
	let heard = 0;
	registry.onChange(() => heard++);
	registry.setUserOrder(['c', 'a']);
	assert.deepEqual(registry.list().map((t) => t.id), ['c', 'a', 'b']);
	assert.equal(heard, 1);
	registry.add({ id: 'd', label: 'D', order: 5 });
	assert.deepEqual(registry.list().map((t) => t.id), ['c', 'a', 'd', 'b'], 'a new tab goes among those the player has not placed, as it asks');
	registry.setUserOrder([]);
	assert.deepEqual(registry.list().map((t) => t.id), ['a', 'd', 'b', 'c']);
});
