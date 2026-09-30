import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushedDistance, PUSH_RANGE } from '../src/lib/xr/interaction/pushPull.ts';

test('the stick pushes a laser-held object away (forward) and brings it closer (back)', () => {
	assert.ok(pushedDistance(2, -1, 0.1) > 2, 'forward pushes it away');
	assert.ok(pushedDistance(2, 1, 0.1) < 2, 'back brings it closer');
	assert.equal(pushedDistance(2, 0.1, 0.1), 2, 'a resting stick leaves it where it is');
});

test('further objects move faster, and they stay between the hand and the far limit', () => {
	const near = 1 - pushedDistance(1, 1, 0.1);
	const far = 8 - pushedDistance(8, 1, 0.1);
	assert.ok(far > near * 3, `far ${far} vs near ${near}`);
	assert.equal(pushedDistance(0.2, 1, 5), PUSH_RANGE.min, 'never into the hand');
	assert.equal(pushedDistance(14, -1, 5), PUSH_RANGE.max);
});
