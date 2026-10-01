import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

const pulse = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/pulse.json', import.meta.url), 'utf8'));
const find = (slot, type) => slot.components.find((c) => c.type === type);
const meshId = (slot) => find(slot, 'meshRenderer')?.meshRef.id;
const isFloor = (slot) => meshId(slot) === 'ground' || meshId(slot) === 'disc';
// The same rule as playerBody.isSolidSlot: a collider you cannot pick up that is not a floor.
const isSolid = (slot) => Boolean(find(slot, 'collider')) && !find(slot, 'grabbable') && !isFloor(slot) && Boolean(find(slot, 'meshRenderer'));
const bounds = (slot) => ({ min: slot.position.map((p, i) => p - slot.scale[i] / 2), max: slot.position.map((p, i) => p + slot.scale[i] / 2) });

test('pulse is a valid world scene', () => {
	assert.ok(pulse.length > 0 && pulse.length <= 2000);
	assert.ok(JSON.stringify(pulse).length < 1_500_000, 'small enough to host and share');
	const ids = new Set();
	for (const slot of pulse) {
		assert.ok(typeof slot.id === 'string' && slot.id && !ids.has(slot.id), `unique id ${slot.id}`);
		ids.add(slot.id);
		assert.equal(slot.position.length, 3);
		assert.equal(slot.rotation.length, 4);
		assert.equal(slot.scale.length, 3);
		for (const component of slot.components) {
			if (component.type === 'meshRenderer') assert.ok(component.meshRef.kind === 'builtin' && isBuiltinMeshId(component.meshRef.id), `${slot.id} uses a built-in mesh`);
		}
	}
	for (const slot of pulse) if (slot.parentId !== null) assert.ok(ids.has(slot.parentId), `${slot.id} has its parent`);
	for (const group of pulse.filter((slot) => find(slot, 'container') && !find(slot, 'grabbable'))) {
		assert.deepEqual([group.position, group.rotation, group.scale], [[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]], `${group.id} does not move what it groups`);
	}
	assert.equal(pulse.filter((slot) => find(slot, 'skybox')).length, 1);
});

test('a player arriving at the origin stands on the floor, with a clear way to the stage', () => {
	const floor = pulse.find((slot) => slot.id === 'pulse-floor');
	assert.equal(meshId(floor), 'ground');
	const half = [floor.scale[0] * 10, floor.scale[2] * 10];
	assert.ok(Math.abs(floor.position[0]) + 1 < half[0] && Math.abs(floor.position[2]) + 1 < half[1], 'the origin is well inside the floor');
	const aisle = { min: [-1, 0.3, -10], max: [1, 1.8, 3] };
	for (const slot of pulse.filter((s) => isSolid(s) && meshId(s) === 'box')) {
		const b = bounds(slot);
		assert.ok(![0, 1, 2].every((i) => b.min[i] < aisle.max[i] && b.max[i] > aisle.min[i]), `${slot.id} blocks the aisle`);
	}
});

test('every raised floor can be stepped onto from the one below it', () => {
	const heights = [...new Set(pulse.filter(isFloor).map((slot) => slot.position[1]))].sort((a, b) => a - b);
	for (let i = 1; i < heights.length; i++) assert.ok(heights[i] - heights[i - 1] <= 0.4, `a ${heights[i] - heights[i - 1]} m step is too tall to walk up`);
});

// --- the screens --------------------------------------------------------------------------------------------------------

/** Runs the script of slot `id` against a small stand-in for the host, which keeps the scene's slots in memory. */
function run(scene, id, { isHost = true } = {}) {
	const byId = new Map(scene.map((slot) => [slot.id, slot]));
	const self = byId.get(id);
	const ctx = {
		self: { id, getComponent: (type) => find(self, type) },
		hierarchy: { getSlot: (slotId) => byId.get(slotId) },
		world: {
			isHost: () => isHost,
			setComponentField: (slotId, type, field, value) => {
				const component = find(byId.get(slotId), type);
				assert.ok(component, `${slotId} has a ${type}`);
				component[field] = value;
			}
		},
		ui: { getInputText: () => undefined }
	};
	const handlers = new Function('ctx', find(self, 'codeBlock').code)(ctx);
	const ui = (slotId, field) => find(byId.get(slotId), 'uiElement')[field];
	return { handlers, ui, byId, press: (slotId) => handlers.onUIEvent({ type: 'press', slotId }) };
}
const fresh = () => structuredClone(pulse);

test('every control a screen script uses exists', () => {
	const ids = new Set(pulse.map((slot) => slot.id));
	for (const board of ['pulse-ideas-board', 'pulse-bugs-board']) {
		for (let i = 0; i < 5; i++) for (const part of ['row', 'up', 'down', 'score', 'text']) assert.ok(ids.has(`${board}-${part}-${i}`), `${board} has ${part} ${i}`);
		assert.ok(ids.has(`${board}-status`));
	}
	for (const part of ['category-idea', 'category-bug', 'category-other', 'input', 'send', 'status']) assert.ok(ids.has(`pulse-suggestion-box-${part}`), `the suggestion box has ${part}`);
	for (let i = 0; i < 4; i++) for (const part of ['button', 'fill', 'count']) assert.ok(ids.has(`pulse-mood-wall-${part}-${i}`), `the mood wall has ${part} ${i}`);
	for (const slot of pulse.filter((s) => find(s, 'codeBlock'))) assert.ok(find(slot, 'uiPanel'), `${slot.id} is a panel`);
});

test('a voting board shows its best entries first, keeps them in place while being voted on, then re-ranks', (t) => {
	let clock = 1_000_000;
	t.mock.method(Date, 'now', () => clock);
	const { handlers, ui, press, byId } = run(fresh(), 'pulse-ideas-board');
	handlers.tick(1);
	const items = find(byId.get('pulse-ideas-board'), 'scriptState').data.items;
	assert.equal(items.length, 7);
	assert.equal(ui('pulse-ideas-board-row-0', 'visible'), true);
	assert.equal(ui('pulse-ideas-board-row-4', 'visible'), true);
	assert.match(ui('pulse-ideas-board-text-0', 'text'), /^Spatial voice chat/);
	assert.equal(ui('pulse-ideas-board-score-0', 'text'), '42');

	// The fifth entry gets enough votes to lead, but stays on its row while the clicks keep coming...
	for (let i = 0; i < 30; i++) press('pulse-ideas-board-up-4');
	assert.equal(ui('pulse-ideas-board-score-4', 'text'), '49');
	assert.match(ui('pulse-ideas-board-text-0', 'text'), /^Spatial voice chat/);
	// ...and takes the top once they stop.
	clock += 2500;
	handlers.tick(1);
	assert.match(ui('pulse-ideas-board-text-0', 'text'), /^A marketplace for player-made objects/);
	assert.equal(ui('pulse-ideas-board-score-0', 'text'), '49');

	// A down vote can be given too.
	press('pulse-ideas-board-down-0');
	assert.equal(ui('pulse-ideas-board-score-0', 'text'), '48');
});

test('a guest does not draw or vote (only the host does)', () => {
	const { handlers, ui } = run(fresh(), 'pulse-bugs-board', { isHost: false });
	handlers.tick(1);
	assert.equal(ui('pulse-bugs-board-row-0', 'visible'), false);
});

test('a suggestion lands on the board of its category, and the same suggestion again is a vote', () => {
	const scene = fresh();
	const box = run(scene, 'pulse-suggestion-box');
	const bugs = () => find(box.byId.get('pulse-bugs-board'), 'scriptState').data.items;
	const before = bugs().length;

	box.press('pulse-suggestion-box-category-bug');
	box.handlers.onUIEvent({ type: 'change', slotId: 'pulse-suggestion-box-input', text: '  The door  sticks ' });
	box.press('pulse-suggestion-box-send');
	assert.equal(bugs().length, before + 1);
	const added = bugs().at(-1);
	assert.equal(added.title, 'The door sticks');
	assert.equal(added.votes, 1);
	assert.match(box.ui('pulse-suggestion-box-status', 'text'), /^Thanks/);

	// A second copy of the script is a fresh sender, so it is not held back by the first one's pause.
	const again = run(scene, 'pulse-suggestion-box');
	again.press('pulse-suggestion-box-category-bug');
	again.handlers.onUIEvent({ type: 'submit', slotId: 'pulse-suggestion-box-input', text: 'the door sticks' });
	assert.equal(bugs().length, before + 1);
	assert.equal(bugs().at(-1).votes, 2);
});

test('a suggestion that is too short is not sent, and is not sent twice in a row', () => {
	const box = run(fresh(), 'pulse-suggestion-box');
	const ideas = () => find(box.byId.get('pulse-ideas-board'), 'scriptState').data.items.length;
	const before = ideas();
	box.handlers.onUIEvent({ type: 'change', slotId: 'pulse-suggestion-box-input', text: 'hi' });
	box.press('pulse-suggestion-box-send');
	assert.equal(ideas(), before);

	box.handlers.onUIEvent({ type: 'change', slotId: 'pulse-suggestion-box-input', text: 'A longer idea' });
	box.press('pulse-suggestion-box-send');
	box.handlers.onUIEvent({ type: 'change', slotId: 'pulse-suggestion-box-input', text: 'Another idea right after' });
	box.press('pulse-suggestion-box-send');
	assert.equal(ideas(), before + 1);
});

test('the mood wall counts a vote and sizes the bars to match', () => {
	const { handlers, ui, press, byId } = run(fresh(), 'pulse-mood-wall');
	handlers.tick(1);
	assert.equal(ui('pulse-mood-wall-fill-1', 'width'), 500, 'the most common mood has the full bar');
	press('pulse-mood-wall-button-0');
	assert.deepEqual(find(byId.get('pulse-mood-wall'), 'scriptState').data.counts, [25, 41, 12, 5]);
	assert.match(ui('pulse-mood-wall-count-0', 'text'), /^25 /);
	for (let i = 0; i < 40; i++) press('pulse-mood-wall-button-3');
	assert.equal(ui('pulse-mood-wall-fill-3', 'width'), 500, 'and a mood that overtakes it takes the full bar');
});
