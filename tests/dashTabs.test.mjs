import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRegistry, tabBarLayout, DEFAULT_TAB_ORDER } from '../src/lib/xr/ui/dashTabs.ts';

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
	const { iconUri, hasIcon, registerIcon } = await import('../src/lib/xr/ui/icons.ts');
	assert.equal(hasIcon('house'), true);
	const uri = iconUri('house', '#ff7a45', 32);
	assert.match(uri, /^data:image\/svg\+xml/);
	const svg = decodeURIComponent(uri.split(',')[1]);
	assert.ok(svg.includes('#ff7a45') && !svg.includes('currentColor') && svg.includes('width="32"'));
	assert.equal(iconUri('nope', '#fff'), undefined);
	registerIcon('mine', '<circle cx="12" cy="12" r="8" fill="currentColor"/>');
	assert.ok(decodeURIComponent(iconUri('mine', '#123456').split(',')[1]).includes('fill="#123456"'));
});
