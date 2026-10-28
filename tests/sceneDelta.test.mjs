import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { DeltaTracker, applyDelta } from '../packages/engine/src/xr/net/sceneDelta.ts';

const label = (text) => createSlot({ id: 'l', name: 'l', components: [{ type: 'uiElement', kind: 'text', text }, { type: 'container' }] });

test('a delta carries only the components that changed, and nothing when nothing did', () => {
	const tracker = new DeltaTracker();
	tracker.reset([label('a')]);
	assert.equal(tracker.diff(label('a')), null);
	const delta = tracker.diff(label('b'));
	assert.deepEqual(delta, { id: 'l', set: [{ type: 'uiElement', kind: 'text', text: 'b' }] });
	assert.equal(tracker.diff(label('b')), null, 'and it is remembered as sent');
});

test('removed components and a switched off slot are in the delta; a slot nobody has heard of is sent whole', () => {
	const tracker = new DeltaTracker();
	tracker.reset([label('a')]);
	const gone = { ...label('a'), components: [{ type: 'container' }] };
	assert.deepEqual(tracker.diff(gone), { id: 'l', remove: ['uiElement'] });
	assert.deepEqual(tracker.diff({ ...gone, disabled: true }), { id: 'l', disabled: true });
	assert.deepEqual(tracker.diff({ ...gone }), { id: 'l', disabled: false });
	const fresh = new DeltaTracker();
	const d = fresh.diff(label('z'));
	assert.equal(d.set.length, 2);
});

test('applying a delta gives the slot the guests should have, and applying it twice changes nothing more', () => {
	const slot = label('a');
	const next = applyDelta(slot, { id: 'l', set: [{ type: 'uiElement', kind: 'text', text: 'b' }, { type: 'collider', shape: 'box' }] });
	assert.deepEqual(next.components.map((c) => c.type), ['uiElement', 'container', 'collider'], 'the order is kept, new ones go last');
	assert.equal(next.components[0].text, 'b');
	assert.equal(slot.components[0].text, 'a', 'the original is untouched');
	const again = applyDelta(next, { id: 'l', set: [{ type: 'uiElement', kind: 'text', text: 'b' }] });
	assert.deepEqual(again.components, next.components);
	assert.deepEqual(applyDelta(next, { id: 'l', remove: ['container'] }).components.map((c) => c.type), ['uiElement', 'collider']);
	assert.equal(applyDelta(next, { id: 'l', disabled: true }).disabled, true);
	assert.equal('disabled' in applyDelta({ ...next, disabled: true }, { id: 'l', disabled: false }), false);
});

test('a slot with two components of one type is sent as a whole list', () => {
	const tracker = new DeltaTracker();
	const two = (a) => createSlot({ id: 'd', name: 'd', components: [{ type: 'collider', shape: 'box' }, { type: 'collider', shape: a }] });
	tracker.reset([two('box')]);
	assert.equal(tracker.diff(two('box')), null);
	assert.equal(tracker.diff(two('sphere')).components.length, 2);
});
