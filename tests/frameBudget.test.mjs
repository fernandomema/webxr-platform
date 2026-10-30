import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameBudget } from '../packages/engine/src/xr/frameBudget.ts';

test('runs the most urgent task first and always at least one per frame', () => {
	const order = [];
	let clock = 0;
	const budget = new FrameBudget(3, () => clock);
	budget.enqueue(() => { order.push('a'); clock += 5; }, 0);
	budget.enqueue(() => { order.push('b'); clock += 5; }, 10);
	budget.enqueue(() => order.push('c'), 5);
	budget.run();
	assert.deepEqual(order, ['b']);
	budget.run();
	assert.deepEqual(order, ['b', 'c', 'a']);
});

test('a task queued again under the same key replaces the earlier one, and cancel removes it', () => {
	const ran = [];
	const budget = new FrameBudget(100);
	budget.enqueue(() => ran.push(1), 0, 'k');
	budget.enqueue(() => ran.push(2), 0, 'k');
	budget.enqueue(() => ran.push(3), 0, 'x');
	budget.cancel('x');
	budget.run();
	assert.deepEqual(ran, [2]);
});
