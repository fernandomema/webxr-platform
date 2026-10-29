import assert from 'node:assert/strict';
import test from 'node:test';
import { LoopGuard, MAX_AGENT_STEPS } from '../src/lib/studio/ai/loopGuard.ts';

const call = (name, args = {}) => [{ id: 'x', name, arguments: args }];

test('a long run is allowed far beyond the old twelve steps', () => {
	assert.ok(MAX_AGENT_STEPS >= 500);
});

test('progress never trips the guard, even with the same tool', () => {
	const guard = new LoopGuard();
	for (let i = 0; i < 100; i++) assert.equal(guard.record(call('stage_update_slot', { id: `s${i}` }), `draft${i}`), null);
});

test('the same request three times in a row on an unchanged draft is a loop', () => {
	const guard = new LoopGuard();
	assert.equal(guard.record(call('list_scene'), 'd'), null);
	assert.equal(guard.record(call('list_scene'), 'd'), null);
	assert.match(guard.record(call('list_scene'), 'd'), /three times|3 times/);
});

test('the same request after the draft changed is not a repeat', () => {
	const guard = new LoopGuard();
	for (let i = 0; i < 10; i++) assert.equal(guard.record(call('validate_draft'), `d${i}`), null);
});

test('a two-step cycle is detected after three rounds', () => {
	const guard = new LoopGuard();
	const steps = [call('inspect_slot', { id: 'a' }), call('validate_draft')];
	let verdict = null;
	for (let i = 0; i < 6 && !verdict; i++) verdict = guard.record(steps[i % 2], 'd');
	assert.match(verdict, /cycling/);
});

test('call order inside one step does not matter', () => {
	const guard = new LoopGuard();
	const a = [...call('x'), ...call('y')];
	const b = [...call('y'), ...call('x')];
	guard.record(a, 'd'); guard.record(b, 'd');
	assert.ok(guard.record(a, 'd'));
});

test('the same step six times across a run is a loop even when interleaved', () => {
	const guard = new LoopGuard();
	let verdict = null;
	for (let i = 0; i < 6 && !verdict; i++) {
		verdict = guard.record(call('list_scene'), 'd');
		if (!verdict) guard.record(call('other', { n: i }), 'd');
	}
	assert.ok(verdict);
});

test('reset clears the memory', () => {
	const guard = new LoopGuard();
	guard.record(call('a'), 'd'); guard.record(call('a'), 'd');
	guard.reset();
	assert.equal(guard.record(call('a'), 'd'), null);
});
