import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedbackAction } from '../src/lib/server/feedbackInput.ts';

test('feedback normalizes submissions and validates categories and length', () => {
	assert.deepEqual(parseFeedbackAction({ action: 'suggest', category: 'bug', title: '  Broken   door ' }), { action: 'suggest', category: 'bug', title: 'Broken door', titleKey: 'broken door' });
	for (const body of [null, {}, { action: 'suggest', category: 'unknown', title: 'Some idea' }, { action: 'suggest', category: 'idea', title: 'abc' }, { action: 'suggest', category: 'idea', title: 'x'.repeat(81) }, { action: 'vote', id: 'a', delta: 99 }, { action: 'mood', key: 'unknown' }]) assert.throws(() => parseFeedbackAction(body));
	assert.deepEqual(parseFeedbackAction({ action: 'vote', id: 'a', delta: -1 }), { action: 'vote', id: 'a', delta: -1 });
	assert.deepEqual(parseFeedbackAction({ action: 'mood', key: 'good' }), { action: 'mood', key: 'good' });
});
