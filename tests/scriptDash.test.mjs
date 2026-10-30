import assert from 'node:assert/strict';
import test from 'node:test';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';
import { buildCodeBlockCtx } from './helpers/codeBlockRuntimeModule.mjs';

function setup(extra = {}) {
	const scene = new Scene(new NullEngine());
	const calls = [];
	const host = {
		getSlot: () => undefined, getNode: () => undefined, getChildren: () => [], allSlots: () => [], getGrabbers: () => [], isHost: () => true,
		getEquipHolder: () => null, requestSpawn() {}, requestDelete() {}, commitTransform() {},
		...extra(calls)
	};
	const ctx = buildCodeBlockCtx('self', new TransformNode('self', scene), host, () => {}, { disposed: false, tracks: new Set() });
	return { ctx, calls };
}

const dashHost = (calls) => ({
	dash: {
		addTab: (owner, tab) => { calls.push(['addTab', owner, tab]); return { slots: { page: 'real-page' } }; },
		removeTab: (owner, id) => { calls.push(['removeTab', owner, id]); return true; },
		showTab: (owner, id) => { calls.push(['showTab', owner, id]); return true; },
		instanceId: () => 'instance-1',
		getSetting: (key) => (key === 'masterVolume' ? 0.5 : null),
		setSetting: (key, value) => { calls.push(['set', key, value]); return key === 'masterVolume'; }
	},
	system: { stats: () => ({ fps: 72 }), session: () => ({ role: 'solo', roomCode: null, worldName: null }) }
});

const page = [{ id: 'page', name: 'Page', components: [{ type: 'uiPanel', width: 100, height: 100 }] }];

test('a script in the menu adds, opens and removes tabs under its own slot, and reads the game', () => {
	const { ctx, calls } = setup(dashHost);
	assert.equal(ctx.dash.available, true);
	assert.deepEqual(ctx.dash.addTab({ id: 'stats', label: 'Stats', icon: 'box', order: 60, ui: page }), { slots: { page: 'real-page' } });
	assert.deepEqual(calls[0], ['addTab', 'self', { id: 'stats', label: 'Stats', icon: 'box', order: 60, ui: page }]);
	assert.equal(ctx.dash.showTab('stats'), true);
	assert.equal(ctx.dash.removeTab('stats'), true);
	assert.deepEqual(calls.slice(1).map((call) => call.slice(0, 3)), [['showTab', 'self', 'stats'], ['removeTab', 'self', 'stats']]);
	assert.equal(ctx.dash.instanceId(), 'instance-1');
	assert.equal(ctx.dash.settings.get('masterVolume'), 0.5);
	assert.equal(ctx.dash.settings.get('anything else'), null);
	assert.equal(ctx.dash.settings.set('masterVolume', 0.2), true);
	assert.equal(ctx.dash.settings.set('masterVolume', NaN), false, 'only real numbers');
	assert.equal(ctx.system.stats().fps, 72);
	assert.equal(ctx.system.session().role, 'solo');
});

test('a tab that is not worth passing on is refused before it reaches the menu', () => {
	const { ctx, calls } = setup(dashHost);
	for (const bad of [null, {}, { id: '', label: 'X', ui: page }, { id: 'a', label: '', ui: page }, { id: 'a', label: 'X' }, { id: 'a', label: 'X', ui: [] }, { id: 'a', label: 'X', ui: 'nope' }, { id: 'x'.repeat(65), label: 'X', ui: page }]) {
		assert.equal(ctx.dash.addTab(bad), null);
	}
	assert.equal(calls.length, 0);
	ctx.dash.addTab({ id: 'a', label: 'L'.repeat(60), icon: 7, order: 'late', ui: page });
	assert.equal(calls[0][2].label.length, 24, 'labels are kept short');
	assert.equal('icon' in calls[0][2], false);
	assert.equal('order' in calls[0][2], false);
});

test('in a world there is no menu to change: the calls answer as nothing', () => {
	const { ctx } = setup(() => ({}));
	assert.equal(ctx.dash.available, false);
	assert.equal(ctx.dash.addTab({ id: 'a', label: 'A', ui: page }), null);
	assert.equal(ctx.dash.instanceId(), null);
	assert.equal(ctx.dash.removeTab('a'), false);
	assert.equal(ctx.dash.showTab('a'), false);
	assert.equal(ctx.dash.settings.get('masterVolume'), null);
	assert.equal(ctx.dash.settings.set('masterVolume', 1), false);
	assert.equal(ctx.system.stats(), null);
	assert.equal(ctx.system.session(), null);
});
