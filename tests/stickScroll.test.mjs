import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerStickScrollTarget, stepStickScroll, stickScrollSpeed, stickScrollTargetFor, STICK_SCROLL_MAX_SPEED } from '../packages/engine/src/xr/interaction/stickScroll.ts';

test('forward scrolls up and back scrolls down, faster the further the stick goes', () => {
	assert.equal(stickScrollSpeed(0.1), 0, 'inside the dead zone nothing scrolls');
	assert.ok(stickScrollSpeed(-0.5) < 0, 'forward (negative) scrolls up');
	assert.ok(stickScrollSpeed(0.5) > 0, 'back scrolls down');
	assert.ok(stickScrollSpeed(0.9) > stickScrollSpeed(0.5) * 2, 'speed grows faster than the tilt');
	assert.equal(stickScrollSpeed(1), STICK_SCROLL_MAX_SPEED);
	assert.equal(stickScrollSpeed(-1), -STICK_SCROLL_MAX_SPEED);
});

test('a stick pushed while the laser is on a list scrolls until let go', () => {
	let step = stepStickScroll('idle', 0, 0, true);
	assert.deepEqual(step, { state: 'idle', claimY: true, claimX: false }, 'forward/back is reserved before the push');
	step = stepStickScroll(step.state, 0.1, -0.8, true);
	assert.deepEqual(step, { state: 'scrolling', claimY: true, claimX: true });
	step = stepStickScroll(step.state, 0.1, -0.8, false);
	assert.equal(step.state, 'scrolling', 'the laser slipping off the list does not hand the stick to walking');
	assert.equal(step.claimY, true);
	step = stepStickScroll(step.state, 0, 0, false);
	assert.deepEqual(step, { state: 'idle', claimY: false, claimX: false });
});

test('a stick already walking, or pushed sideways, is never taken by a list', () => {
	let step = stepStickScroll('idle', 0, -0.8, false);
	assert.equal(step.state, 'free');
	step = stepStickScroll(step.state, 0, -0.8, true);
	assert.deepEqual(step, { state: 'free', claimY: false, claimX: false }, 'walking onto a panel keeps walking');
	step = stepStickScroll('idle', 0.9, 0.2, true);
	assert.deepEqual(step, { state: 'free', claimY: false, claimX: false }, 'a sideways push still turns');
});

function guiFixture({ content = 1000, client = 400, barVisible = true } = {}) {
	const bar = { isVisible: barVisible, value: 0, maximum: 1 };
	const viewer = { parent: null, isEnabled: true, isReadOnly: false, verticalBar: bar, getClassName: () => 'ScrollViewer', _window: { _currentMeasure: { height: content } }, _clientHeight: client };
	const stack = { parent: viewer, isEnabled: true, getClassName: () => 'StackPanel' };
	const row = { parent: stack, isEnabled: true, getClassName: () => 'Button' };
	const header = { parent: null, isEnabled: true, getClassName: () => 'TextBlock' };
	const texture = { getClassName: () => 'AdvancedDynamicTexture', _lastControlOver: { 7: row, 8: header } };
	const mesh = { material: { getActiveTextures: () => [{ getClassName: () => 'Texture' }, texture] } };
	return { bar, mesh };
}

test('a GUI panel scrolls the list the laser is over, in pixels of its texture', () => {
	const { bar, mesh } = guiFixture();
	const target = stickScrollTargetFor(mesh);
	assert.ok(target);
	assert.equal(target.canScroll({}, 7), true);
	assert.equal(target.canScroll({}, 8), false, 'a control outside any list does not scroll');
	assert.equal(target.canScroll({}, undefined), false);
	target.scrollBy({}, 7, 150);
	assert.equal(bar.value, 0.25, '150 of 600 overflowing pixels');
	target.scrollBy({}, 7, -1000);
	assert.equal(bar.value, 0, 'never past the top');
	target.scrollBy({}, 7, 5000);
	assert.equal(bar.value, 1, 'never past the bottom');
});

test('a list whose content fits does not take the stick, nor does a mesh without GUI', () => {
	const { mesh } = guiFixture({ content: 300, barVisible: false });
	assert.equal(stickScrollTargetFor(mesh).canScroll({}, 7), false);
	assert.equal(stickScrollTargetFor({ material: { getActiveTextures: () => [] } }), null);
	assert.equal(stickScrollTargetFor(null), null);
});

test('a registered surface takes over its mesh until unregistered', () => {
	const { mesh } = guiFixture();
	const own = { canScroll: () => true, scrollBy() {} };
	const stop = registerStickScrollTarget(mesh, own);
	assert.equal(stickScrollTargetFor(mesh), own);
	stop();
	assert.notEqual(stickScrollTargetFor(mesh), own);
});
