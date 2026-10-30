import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteRadial } from '../packages/engine/src/xr/ui/remoteRadial.ts';

/** A stand-in for GuestSync: the host answers with whatever `options` holds when asked. */
function fakeHost(options) {
	const picks = [];
	return {
		picks,
		options,
		async requestRadialItems() { return this.options; },
		async selectRadialItem(slotId, hand, index, label) {
			picks.push({ slotId, hand, index, label });
			return this.options;
		}
	};
}

test('a guest has no host options until it asks, then keeps the last answer', async () => {
	const host = fakeHost([{ label: 'Color: Red', enabled: true }]);
	const remote = createRemoteRadial(() => host);
	assert.equal(remote.active(), true);
	assert.equal(remote.cached('brush'), undefined);
	assert.equal(await remote.refresh('right', 'brush'), true);
	assert.deepEqual(remote.cached('brush'), [{ label: 'Color: Red', enabled: true }]);
	assert.equal(await remote.refresh('right', 'brush'), false, 'the same answer is no change');
});

test('a pick goes to the host, and its answer replaces the options', async () => {
	const host = fakeHost([{ label: 'Color: Red', enabled: true }]);
	const remote = createRemoteRadial(() => host);
	await remote.refresh('right', 'brush');
	host.options = [{ label: 'Color: Orange', enabled: true }];
	await remote.select('right', 'brush', 0, 'Color: Red');
	assert.deepEqual(host.picks, [{ slotId: 'brush', hand: 'right', index: 0, label: 'Color: Red' }]);
	assert.deepEqual(remote.cached('brush'), [{ label: 'Color: Orange', enabled: true }]);
});

test('a host that does not answer leaves the last options alone', async () => {
	const host = fakeHost([{ label: 'Size: Medium', enabled: true }]);
	const remote = createRemoteRadial(() => host);
	await remote.refresh('left', 'brush');
	host.options = null;
	assert.equal(await remote.refresh('left', 'brush'), false);
	assert.deepEqual(remote.cached('brush'), [{ label: 'Size: Medium', enabled: true }]);
});

test('not a guest, or a new session: nothing cached is used', async () => {
	let current = fakeHost([{ label: 'Undo', enabled: true }]);
	const remote = createRemoteRadial(() => current);
	await remote.refresh('right', 'tool');
	current = fakeHost([]);
	assert.equal(remote.cached('tool'), undefined, 'a new session drops the old answers');
	current = null;
	assert.equal(remote.active(), false);
	assert.equal(remote.cached('tool'), undefined);
});
