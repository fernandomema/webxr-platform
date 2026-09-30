import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDashboardLayout, toggleDashboardItem, moveDashboardItem, dashboardEditorOrder, DEFAULT_DASHBOARD_LAYOUT } from '../src/lib/xr/dashboardLayout.ts';

test('a missing or malformed saved layout falls back to the default', () => {
	assert.deepEqual(normalizeDashboardLayout(undefined), [...DEFAULT_DASHBOARD_LAYOUT]);
	assert.deepEqual(normalizeDashboardLayout('inspector'), [...DEFAULT_DASHBOARD_LAYOUT]);
});

test('unknown ids and repeats are dropped, order is kept, and an empty layout is allowed', () => {
	assert.deepEqual(normalizeDashboardLayout(['exit-vr', 'nope', 7, 'exit-vr', 'seated']), ['exit-vr', 'seated']);
	assert.deepEqual(normalizeDashboardLayout([]), []);
});

test('toggling shows an item at the end or hides it', () => {
	assert.deepEqual(toggleDashboardItem(['seated'], 'inspector'), ['seated', 'inspector']);
	assert.deepEqual(toggleDashboardItem(['seated', 'inspector'], 'seated'), ['inspector']);
});

test('moving swaps with a neighbour and stops at the ends', () => {
	assert.deepEqual(moveDashboardItem(['seated', 'inspector', 'exit-vr'], 'exit-vr', -1), ['seated', 'exit-vr', 'inspector']);
	assert.deepEqual(moveDashboardItem(['seated', 'inspector'], 'seated', -1), ['seated', 'inspector']);
	assert.deepEqual(moveDashboardItem(['seated', 'inspector'], 'inspector', 1), ['seated', 'inspector']);
	assert.deepEqual(moveDashboardItem(['seated'], 'exit-vr', 1), ['seated'], 'a hidden item cannot be moved');
});

test('the editor lists shown items first, then hidden ones', () => {
	assert.deepEqual(dashboardEditorOrder(['exit-vr']), [
		{ id: 'exit-vr', shown: true },
		{ id: 'seated', shown: false },
		{ id: 'inspector', shown: false }
	]);
});
