import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildWishEngine, WISH, WISH_ENGINE_SCRIPT } from '../src/lib/xr/templates/wishEngine.ts';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

const tree = buildWishEngine();
const component = (slot, type) => slot?.components.find((item) => item.type === type);

function world({ host = true, snapshot = tree } = {}) {
	const slots = new Map(structuredClone(snapshot).map((slot) => [slot.id, slot]));
	const mutations = [], sounds = [];
	const ctx = {
		hierarchy: {
			getSlot: (id) => slots.get(id),
			getWorldPose: (id) => slots.has(id) ? { position: slots.get(id).position, rotation: slots.get(id).rotation } : undefined
		},
		world: {
			isHost: () => host,
			setComponentField(id, type, key, value) {
				assert.ok(host, 'guests cannot mutate world data');
				const c = component(slots.get(id), type);
				assert.ok(c, `${id} has ${type}`);
				c[key] = structuredClone(value); mutations.push(id);
			},
			setSlotEnabled(id, enabled) {
				assert.ok(host);
				assert.ok(slots.has(id), `${id} exists`);
				slots.get(id).disabled = !enabled;
			},
			setWorldPose(id, pose) { Object.assign(slots.get(id), structuredClone(pose)); return true; },
			deleteSlot(id) { slots.delete(id); },
			spawn(slot) { if (slot.id) slots.set(slot.id, structuredClone(slot)); else sounds.push(slot); }
		},
		audio: { playTrack: async () => ({ stop() {} }) },
		log() {}
	};
	const runtime = new Function('ctx', WISH_ENGINE_SCRIPT)(ctx);
	const advance = (seconds) => { for (let i = 0; i < Math.ceil(seconds * 10); i++) runtime.tick(0.1); };
	const click = (id) => runtime.onUIEvent({ type: 'press', slotId: id });
	const state = () => component(slots.get(WISH.director), 'scriptState').data;
	const insert = (socket, object) => {
		component(slots.get(socket), 'socket').occupantId = object;
		slots.get(object).parentId = socket;
		advance(0.2);
	};
	advance(0.1);
	return { slots, runtime, advance, click, state, insert, mutations, sounds };
}

test('Wish Engine builds independent valid scenes with compilable scripts and bundled score', () => {
	const ids = new Set(tree.map((slot) => slot.id));
	assert.equal(ids.size, tree.length);
	assert.ok(tree.length < 600, 'the scene has a bounded population');
	assert.equal(component(tree.find((slot) => slot.id === 'we-floor'), 'collider').shape, 'box', 'primitive floors use the primitive collision path');
	for (const slot of tree) {
		if (slot.parentId) assert.ok(ids.has(slot.parentId), slot.id);
		for (const field of ['position', 'rotation', 'scale']) assert.ok(slot[field].every(Number.isFinite));
		const mesh = component(slot, 'meshRenderer');
		if (mesh) assert.ok(isBuiltinMeshId(mesh.meshRef.id));
		const code = component(slot, 'codeBlock');
		if (code) assert.doesNotThrow(() => new Function('ctx', code.code), slot.id);
	}
	const copy = buildWishEngine();
	component(copy[0], 'scriptState').data.lights[0] = true;
	assert.equal(component(tree[0], 'scriptState').data.lights[0], false);
	for (const name of ['light', 'time', 'sky', 'release']) assert.ok(existsSync(new URL(`../static/audio/wish-engine/${name}.ogg`, import.meta.url)));
});

test('the complete journey can be played through the accessible controls and repeated', () => {
	const w = world();
	w.click('we-release');
	assert.equal(w.state().phase, 'idle', 'later actions cannot skip the journey');
	w.click('we-start'); w.click('we-start');
	assert.equal(w.state().phase, 'awakening');
	w.advance(16.2);
	assert.equal(w.state().phase, 'light');
	w.click('we-kindle-2'); w.click('we-kindle-2');
	assert.deepEqual(w.state().lights, [false, false, true]);
	w.click('we-kindle-0'); w.click('we-kindle-1');
	assert.equal(w.state().phase, 'lightReveal');
	w.advance(18.2);
	assert.equal(w.state().phase, 'time');
	for (let i = 0; i < 3; i++) for (let turn = 0; turn < 3 - i; turn++) w.click(`we-turn-${i}`);
	assert.equal(w.state().phase, 'timeReveal');
	w.advance(18.2);
	assert.equal(w.state().phase, 'sky');
	for (const i of [1, 2, 0]) w.click(`we-place-${i}`);
	assert.equal(w.state().phase, 'skyReveal');
	w.advance(20.2);
	assert.equal(w.state().phase, 'release');
	assert.ok(!w.slots.get('we-coin').disabled);
	w.click('we-release'); w.advance(28.2);
	assert.equal(w.state().phase, 'afterglow');
	assert.equal(component(w.slots.get('we-coin'), 'meshRenderer').color, '#b9eeff');
	w.click('we-again');
	assert.equal(w.state().phase, 'idle');
	assert.equal(w.state().run, 1);
	assert.deepEqual(w.state().lights, [false, false, false]);
	assert.equal(w.slots.get('we-coin').parentId, null);
	assert.ok(w.slots.get('we-spark').disabled);
});

test('physical sockets, spark proximity and touch seals advance the same journey', () => {
	const w = world();
	// A stale occupant pointer alone is not an insertion.
	component(w.slots.get('we-coin-slot'), 'socket').occupantId = 'we-coin';
	w.advance(0.2);
	assert.equal(w.state().phase, 'idle');
	w.insert('we-coin-slot', 'we-coin'); w.advance(16.2);
	w.slots.get('we-spark').position = [...WISH.lamps[0]]; w.advance(0.2);
	assert.equal(w.state().lights[0], true);
	for (const i of [1, 2]) {
		component(w.slots.get(WISH.director), 'scriptState').request = { action: `we-kindle-${i}`, run: 0 };
		w.advance(0.2);
	}
	w.advance(18.2);
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) w.click(`we-turn-${i}`);
	w.advance(18.2);
	for (let i = 0; i < 3; i++) w.insert(`we-star-socket-${i}`, `we-fragment-${i}`);
	assert.equal(w.state().phase, 'skyReveal');
	w.advance(20.2);
	assert.equal(w.slots.get('we-coin').parentId, null, 'returned coin is no longer attached to the machine');
	w.insert('we-wish-bowl', 'we-coin');
	assert.equal(w.state().phase, 'finale');
});

test('lost objects return, solved pieces stay solved, and confirmed reset invalidates old requests', () => {
	const w = world();
	w.slots.get('we-coin').position = [0, -5, 0]; w.advance(0.2);
	assert.deepEqual(w.slots.get('we-coin').position, [0.85, 1.06, 4.1]);
	w.click('we-start'); w.advance(16.2); w.click('we-kindle-0');
	w.click('we-recall');
	assert.deepEqual(w.state().lights, [true, false, false]);
	w.click('we-reset');
	assert.equal(w.state().phase, 'light', 'one accidental click does not reset the group');
	w.advance(6); w.click('we-reset');
	assert.equal(w.state().phase, 'light', 'expired confirmation must be requested again');
	w.click('we-reset');
	assert.equal(w.state().phase, 'idle');
	component(w.slots.get(WISH.director), 'scriptState').request = { action: 'we-start', run: 0 };
	w.advance(0.2);
	assert.equal(w.state().phase, 'idle', 'requests from the old run are ignored');
});

test('a guest reconstructs the current chapter without executing host progression', () => {
	const host = world();
	host.click('we-start'); host.advance(16.2); host.click('we-kindle-1');
	const guest = world({ host: false, snapshot: [...host.slots.values()] });
	guest.advance(40); guest.click('we-kindle-0'); guest.click('we-reset');
	assert.equal(guest.state().phase, 'light');
	assert.deepEqual(guest.state().lights, [false, true, false]);
	assert.equal(guest.mutations.length, 0);
	assert.equal(guest.sounds.length, 0);
});

test('decorative scripts reconstruct every chapter on a guest and produce finite transforms', () => {
	for (const phase of ['idle', 'awakening', 'lightReveal', 'time', 'timeReveal', 'skyReveal', 'release', 'finale', 'afterglow']) {
		for (const slot of tree) {
			const code = component(slot, 'codeBlock');
			if (!code || slot.id === WISH.director || !code.code.includes('setLocalTransform')) continue;
			let pose;
			const runtime = new Function('ctx', code.code)({
				hierarchy: { getSlot: () => ({ components: [{ type: 'scriptState', data: { phase, time: 8, run: 2, stars: [true, true, true], lights: [true, true, true], rings: [0, 0, 0] } }] }) },
				self: { setLocalTransform(value) { pose = value; } },
				math: {
					quatFromAxisAngle: (axis, a) => [...axis.map((v) => v * Math.sin(a / 2)), Math.cos(a / 2)],
					quatMultiply: (a) => a
				}
			});
			runtime.tick(1 / 72);
			assert.ok(pose.position.every(Number.isFinite) && pose.rotation.every(Number.isFinite), `${slot.id} in ${phase}`);
			assert.ok(pose.scale.every((value) => Number.isFinite(value) && value > 0));
		}
	}
});
