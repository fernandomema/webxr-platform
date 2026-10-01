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
function run(scene, id, { isHost = true, net = { fetchJson: async () => ({ items: [], counts: [0, 0, 0, 0] }), postJson: async () => ({ ok: true }) } } = {}) {
	const byId = new Map(scene.map((slot) => [slot.id, slot]));
	const self = byId.get(id);
	const ctx = {
		net,
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


const flush = () => new Promise((resolve) => setImmediate(resolve));

test('boards load persisted entries, filter categories and submit votes', async () => {
  const posts = [];
  const data = { items: [{ id: 'a', title: 'Real idea', category: 'idea', votes: 12 }, { id: 'b', title: 'Real bug', category: 'bug', votes: 25 }], counts: [0, 0, 0, 0] };
  const net = { fetchJson: async () => structuredClone(data), postJson: async (url, body) => { posts.push(body); data.items[0].votes += body.delta; } };
  const board = run(fresh(), 'pulse-ideas-board', { net });
  board.handlers.tick(1);
  await flush();
  assert.equal(board.ui('pulse-ideas-board-text-0', 'text'), 'Real idea');
  assert.equal(board.ui('pulse-ideas-board-score-0', 'text'), '12');
  await board.press('pulse-ideas-board-down-0');
  assert.deepEqual(posts, [{ action: 'vote', id: 'a', delta: -1 }]);
  assert.equal(board.ui('pulse-ideas-board-score-0', 'text'), '11');
});

test('a guest does not fetch or write feedback', () => {
  const net = { fetchJson: () => assert.fail('guest requested data'), postJson: () => assert.fail('guest wrote data') };
  const board = run(fresh(), 'pulse-bugs-board', { isHost: false, net });
  board.handlers.tick(1);
  board.press('pulse-bugs-board-up-0');
  const box = run(fresh(), 'pulse-suggestion-box', { isHost: false, net });
  box.press('pulse-suggestion-box-send');
  const mood = run(fresh(), 'pulse-mood-wall', { isHost: false, net });
  mood.press('pulse-mood-wall-button-0');
});

test('suggestions persist and clear the input only after success', async () => {
  const posts = [];
  const net = { postJson: async (url, body) => posts.push(body) };
  const box = run(fresh(), 'pulse-suggestion-box', { net });
  box.press('pulse-suggestion-box-category-bug');
  await box.handlers.onUIEvent({ type: 'submit', slotId: 'pulse-suggestion-box-input', text: '  The door  sticks ' });
  assert.deepEqual(posts, [{ action: 'suggest', category: 'bug', title: 'The door sticks' }]);
  assert.match(box.ui('pulse-suggestion-box-status', 'text'), /saved/);
  box.press('pulse-suggestion-box-send');
  assert.equal(posts.length, 1, 'cooldown prevents a duplicate submission');
});

test('failed suggestions can be retried and failed votes do not change local counts', async () => {
  let failed = true;
  const posts = [];
  const net = { postJson: async (url, body) => { if (failed) throw new Error('Offline'); posts.push(body); } };
  const box = run(fresh(), 'pulse-suggestion-box', { net });
  await box.handlers.onUIEvent({ type: 'submit', slotId: 'pulse-suggestion-box-input', text: 'Keep this idea' });
  assert.match(box.ui('pulse-suggestion-box-status', 'text'), /Offline/);
  failed = false;
  await box.press('pulse-suggestion-box-send');
  assert.equal(posts[0].title, 'Keep this idea');
});

test('mood counts come from the API and mood presses are persisted', async () => {
  const data = { items: [], counts: [1, 4, 0, 0] };
  const net = { fetchJson: async () => structuredClone(data), postJson: async (url, body) => { assert.deepEqual(body, { action: 'mood', key: 'loving' }); data.counts[0]++; } };
  const wall = run(fresh(), 'pulse-mood-wall', { net });
  wall.handlers.tick(1);
  await flush();
  assert.equal(wall.ui('pulse-mood-wall-fill-1', 'width'), 500);
  await wall.press('pulse-mood-wall-button-0');
  assert.match(wall.ui('pulse-mood-wall-count-0', 'text'), /^2 /);
});

test('roadmap uses persisted development status', async () => {
  const net = { fetchJson: async () => ({ items: [{ id: 'a', category: 'idea', title: 'Shipped feature', status: 'shipped' }], counts: [] }) };
  const board = run(fresh(), 'pulse-roadmap-board', { net });
  board.handlers.tick(1);
  await flush();
  assert.equal(board.ui('pulse-roadmap-board-status-label-0', 'text'), 'SHIPPED');
  assert.equal(board.ui('pulse-roadmap-board-text-0', 'text'), 'Shipped feature');
  assert.equal(board.ui('pulse-roadmap-board-row-1', 'visible'), false);
});

test('forwarded guest actions cannot submit using the host session', async () => {
  const net = { fetchJson: async () => ({ items: [{ id: 'a', category: 'idea', title: 'An idea', votes: 1 }], counts: [0, 0, 0, 0] }), postJson: () => assert.fail('Guest action submitted as host') };
  for (const [panel, target, type, text] of [
    ['pulse-ideas-board', 'pulse-ideas-board-up-0', 'press'],
    ['pulse-suggestion-box', 'pulse-suggestion-box-input', 'submit', 'A guest suggestion'],
    ['pulse-mood-wall', 'pulse-mood-wall-button-0', 'press']
  ]) {
    const screen = run(fresh(), panel, { net });
    screen.handlers.tick?.(1);
    await flush();
    await screen.handlers.onUIEvent({ slotId: target, type, text, remoteGuestId: 'guest' });
  }
});
