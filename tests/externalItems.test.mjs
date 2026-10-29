import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import {
	EXTERNAL_LIMITS, ExternalItemError, externalSlotId, externalSourceKey, instantiateExternal, normalizeExternalSource, validateExternalTree
} from '../packages/engine/src/inventory/external.ts';
import { setupLoader } from '../packages/engine/src/xr/loaderRuntime.ts';
import { validateWorldScene } from '../packages/engine/src/worlds/package.ts';
import {
	WORLD_ITEM_LIMITS, WorldItemError, createMemoryWorldItemBackend, createWorldItemStore, validateWorldItemInput
} from '../packages/engine/src/worldStorage/items.ts';
import { createScriptWorldItems } from '../packages/engine/src/xr/scriptWorldItems.ts';
import { withoutExternal } from '../packages/engine/src/ecs/serialize.ts';

const disc = () => [
	createSlot({ id: 'disc', name: 'Disc', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' } }] }),
	createSlot({ id: 'label', parentId: 'disc', name: 'Label', position: [0, 0.01, 0] })
];

test('only the allowed sources are understood, and they are named the same way every time', () => {
	assert.deepEqual(normalizeExternalSource({ adapter: 'builtin', id: 'chair' }), { adapter: 'builtin', id: 'chair' });
	assert.deepEqual(normalizeExternalSource({ adapter: 'worldStorage', key: 'disc-1', extra: 1 }), { adapter: 'worldStorage', key: 'disc-1' });
	assert.equal(normalizeExternalSource({ adapter: 'local', id: 'x' }), null, 'a device-bound inventory is not a source');
	assert.equal(normalizeExternalSource({ adapter: 'purchased', id: 'x' }), null);
	assert.equal(normalizeExternalSource({ adapter: 'cloud' }), null, 'a source with nothing to name');
	assert.equal(normalizeExternalSource({ adapter: 'worldStorage' }), null);
	assert.equal(normalizeExternalSource({ adapter: 'cloud', id: 'x'.repeat(201) }), null);
	assert.equal(normalizeExternalSource('cloud:abc'), null);
	assert.notEqual(externalSourceKey({ adapter: 'cloud', id: 'a' }), externalSourceKey({ adapter: 'marketplace', id: 'a' }));
});

test('an object from outside is checked, and the external mark is never taken from it', () => {
	const tree = validateExternalTree([{ ...disc()[0], external: true }, disc()[1]]);
	assert.ok(tree.every((slot) => slot.external === undefined), 'the mark is set here, not read');
	for (const bad of [null, [], 'x', [{ id: 'a' }], [createSlot({ id: 'a', name: 'a' }), createSlot({ id: 'a', name: 'b' })], [{ ...disc()[0], position: [0, 0] }], [{ ...disc()[0], position: [NaN, 0, 0] }]]) {
		assert.throws(() => validateExternalTree(bad), ExternalItemError);
	}
	assert.throws(() => validateExternalTree(Array.from({ length: EXTERNAL_LIMITS.maxSlots + 1 }, (_, i) => createSlot({ id: `s${i}`, name: 'x' }))), /at most/);
	assert.throws(() => validateExternalTree([createSlot({ id: 'a', parentId: 'b', name: 'a' }), createSlot({ id: 'b', parentId: 'a', name: 'b' })]), /no root/);
});

test('built for an owner, ids are its own, roots hang from where it says, everything is marked external', () => {
	const slots = instantiateExternal('shelf', validateExternalTree(disc()), 'rack', { position: [1, 2, 3] });
	assert.deepEqual(slots.map((slot) => slot.id), ['shelf::disc', 'shelf::label']);
	assert.equal(slots[0].parentId, 'rack', 'the root hangs from the parent given');
	assert.equal(slots[1].parentId, externalSlotId('shelf', 'disc'));
	assert.deepEqual(slots[0].position, [1, 2, 3], 'a pose replaces the root placement');
	assert.deepEqual(slots[1].position, [0, 0.01, 0], 'and leaves the rest alone');
	assert.ok(slots.every((slot) => slot.external === true));
	assert.notEqual(instantiateExternal('a', disc(), null)[0].id, instantiateExternal('b', disc(), null)[0].id, 'the same object can be built twice');
});

test('a world never keeps what a loader brought in, and a loader is stored as a plain reference', () => {
	const world = (extra) => [createSlot({ id: 'root', name: 'root', components: [{ type: 'loader', adapter: 'builtin', id: '' }, ...extra] })];
	validateWorldScene(world([]));
	validateWorldScene([createSlot({ id: 'l', name: 'l', components: [{ type: 'loader', adapter: 'worldStorage', key: 'disc-1' }] })]);
	assert.throws(() => validateWorldScene([createSlot({ id: 'l', name: 'l', components: [{ type: 'loader', adapter: 'local', id: 'x' }] })]), /loader/, 'an inventory only one device has is not a source');
	assert.throws(() => validateWorldScene([createSlot({ id: 'l', name: 'l', components: [{ type: 'loader', adapter: 'cloud', id: 'x'.repeat(201) }] })]), /loader/);
	assert.throws(() => validateWorldScene([createSlot({ id: 'a', name: 'a' }), { ...createSlot({ id: 'a::b', name: 'b' }), external: true }]), /Invalid world slot/);
	assert.deepEqual(withoutExternal([{ ...createSlot({ id: 'a', name: 'a' }), external: true }])[0].external, undefined);
});

// A host for the loader that records what it was asked, with a resolver that answers from a table.
function loaderHarness(options = {}) {
	const state = { enabled: true, isHost: true, ancestors: [], loaded: [], unloaded: [], resolved: [], accept: true, time: 0, errors: [] };
	const table = options.table ?? { 'builtin:chair:': disc() };
	const host = {
		isHost: () => state.isHost,
		isEnabled: () => state.enabled,
		ancestors: () => state.ancestors,
		resolve: async (source) => {
			state.resolved.push(externalSourceKey(source));
			const item = table[externalSourceKey(source)];
			if (item instanceof Error) throw item;
			if (!item) throw new ExternalItemError('not-found', 'nothing');
			return { name: 'x', slots: item };
		},
		load: (ownerId, slots) => { if (state.accept) state.loaded.push([ownerId, slots]); return state.accept; },
		unload: (ownerId) => state.unloaded.push(ownerId)
	};
	const binding = setupLoader('owner', { type: 'loader', adapter: 'builtin', id: 'chair' }, host, () => state.time, (_id, status) => state.errors.push(status));
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { state, binding, settle };
}

test('a loader asks for its object once it is on, builds it, and takes it down when it is switched off', async () => {
	const { state, binding, settle } = loaderHarness();
	binding.tick();
	assert.equal(binding.status.state, 'loading');
	await settle();
	assert.equal(binding.status.state, 'ready');
	assert.equal(state.loaded.length, 1);
	assert.equal(state.loaded[0][1][0].parentId, 'owner');
	binding.tick(); binding.tick();
	assert.equal(state.resolved.length, 1, 'it is not asked again while it is built');
	state.enabled = false;
	binding.tick();
	assert.deepEqual(state.unloaded, ['owner']);
	assert.equal(binding.status.state, 'idle');
	state.enabled = true;
	binding.tick();
	await settle();
	assert.equal(state.loaded.length, 2, 'on again, it is built again');
});

test('only the host reads; guests wait for what the host built', async () => {
	const { state, binding, settle } = loaderHarness();
	state.isHost = false;
	binding.tick();
	await settle();
	assert.equal(state.resolved.length, 0);
	assert.equal(binding.status.state, 'idle');
});

test('a loader with nothing chosen yet is idle, not an error', async () => {
	const state = { resolved: 0 };
	const host = { isHost: () => true, isEnabled: () => true, ancestors: () => [], resolve: async () => { state.resolved++; return { name: '', slots: [] }; }, load: () => true, unload() {} };
	const binding = setupLoader('o', { type: 'loader', adapter: 'builtin', id: '' }, host);
	binding.tick();
	assert.equal(binding.status.state, 'idle');
	assert.equal(state.resolved, 0);
});

test('a source that is gone leaves the slot empty with the reason, and is not asked again until it changes', async () => {
	const { state, binding, settle } = loaderHarness({ table: {} });
	binding.tick();
	await settle();
	assert.deepEqual(binding.status, { state: 'error', code: 'not-found', message: 'nothing' });
	assert.equal(state.errors.length, 1, 'the reason is reported once');
	state.time += 3_600_000;
	binding.tick();
	await settle();
	assert.equal(state.resolved.length, 1, 'a missing or private object is not retried');
	binding.sync({ type: 'loader', adapter: 'builtin', id: 'other' });
	binding.tick();
	await settle();
	assert.equal(state.resolved.length, 2, 'a new source is');
});

test('a server that cannot be reached is tried again after a while', async () => {
	const { state, binding, settle } = loaderHarness({ table: { 'builtin:chair:': new ExternalItemError('unavailable', 'offline') } });
	binding.tick();
	await settle();
	assert.equal(binding.status.code, 'unavailable');
	binding.tick();
	assert.equal(state.resolved.length, 1, 'not at once');
	state.time += 16_000;
	binding.tick();
	await settle();
	assert.equal(state.resolved.length, 2);
});

test('an object that contains itself, or nests too deep, is refused', async () => {
	const cycle = loaderHarness();
	cycle.state.ancestors = [externalSourceKey({ adapter: 'builtin', id: 'chair' })];
	cycle.binding.tick();
	assert.equal(cycle.binding.status.code, 'cycle');
	assert.equal(cycle.state.resolved.length, 0);
	const deep = loaderHarness();
	deep.state.ancestors = Array.from({ length: EXTERNAL_LIMITS.maxDepth }, (_, i) => `x:${i}:`);
	deep.binding.tick();
	assert.equal(deep.binding.status.code, 'too-deep');
});

test('going over the budget, or getting a broken object, is an error and builds nothing', async () => {
	const over = loaderHarness();
	over.state.accept = false;
	over.binding.tick();
	await over.settle();
	assert.equal(over.binding.status.code, 'budget');
	const broken = loaderHarness({ table: { 'builtin:chair:': [{ id: 'a' }] } });
	broken.binding.tick();
	await broken.settle();
	assert.equal(broken.binding.status.code, 'invalid-item');
	assert.equal(broken.state.loaded.length, 0);
});

test('deleting the loader while it is reading builds nothing', async () => {
	const { state, binding, settle } = loaderHarness();
	binding.tick();
	binding.dispose();
	await settle();
	assert.equal(state.loaded.length, 0);
});

const tree = (n = 1) => Array.from({ length: n }, (_, i) => createSlot({ id: `s${i}`, name: `s${i}` }));
const rig = (opts = {}) => {
	const local = createMemoryWorldItemBackend('local');
	const cloud = createMemoryWorldItemBackend('cloud', { available: () => rig.signedIn });
	rig.signedIn = true;
	let location = opts.location ?? 'local';
	let publicationId = 'pub-1';
	const store = createWorldItemStore({ backends: { local, cloud }, getLocation: () => location, getPublicationId: () => publicationId });
	return { local, cloud, store, setLocation: (l) => { location = l; }, setPublication: (p) => { publicationId = p; } };
};

test('objects are kept where the host chose, and found by key or id', async () => {
	const { store, local, cloud } = rig();
	const saved = await store.save({ key: 'disc-1', name: 'Disc 1', slotData: tree(2) });
	assert.equal(local.items.size, 1);
	assert.equal(cloud.items.size, 0, 'nothing goes to the other place');
	assert.equal((await store.find({ key: 'disc-1' })).id, saved.id);
	assert.equal((await store.find({ id: saved.id })).name, 'Disc 1');
	const again = await store.save({ key: 'disc-1', name: 'Disc one', slotData: tree(3) });
	assert.equal(again.id, saved.id, 'the same key replaces the object');
	assert.equal(local.items.size, 1);
	assert.equal((await store.list()).length, 1);
});

test('reading falls back to the other place, writing does not', async () => {
	const { store, local, cloud, setLocation } = rig();
	await store.save({ key: 'a', name: 'A', slotData: tree() });
	setLocation('cloud');
	assert.equal((await store.list()).length, 0, 'the list is of the chosen place');
	assert.equal((await store.find({ key: 'a' }))?.name, 'A', 'but an object saved before the change is still found');
	await store.save({ key: 'b', name: 'B', slotData: tree() });
	assert.equal(cloud.items.size, 1);
	assert.equal(local.items.size, 1, 'new objects go to the cloud and the old one stays');
	await store.save({ key: 'a', name: 'A2', slotData: tree() });
	assert.equal(cloud.items.size, 2, 'saving a key that only the other place has writes to the chosen one');
	assert.equal((await store.find({ key: 'a' })).name, 'A2', 'which now wins');
});

test('an object edited by id stays where it is', async () => {
	const { store, local, cloud, setLocation } = rig();
	const saved = await store.save({ name: 'A', slotData: tree() });
	setLocation('cloud');
	await store.save({ id: saved.id, name: 'Renamed', slotData: tree() });
	assert.equal(cloud.items.size, 0);
	assert.equal([...local.items.values()][0].name, 'Renamed');
});

test('deleting removes it from both places, so it does not come back through the fallback', async () => {
	const { store, local, cloud, setLocation } = rig();
	await store.save({ key: 'a', name: 'A', slotData: tree() });
	setLocation('cloud');
	await store.save({ key: 'a', name: 'A cloud', slotData: tree() });
	assert.equal(local.items.size + cloud.items.size, 2);
	assert.equal(await store.remove({ key: 'a' }), true);
	assert.equal(local.items.size + cloud.items.size, 0);
	assert.equal(await store.find({ key: 'a' }), null);
	assert.equal(await store.remove({ key: 'a' }), false);
});

test('without a published world, or with the chosen place unusable, nothing can be saved; reading still tries the other', async () => {
	const { store, setPublication, setLocation, local } = rig();
	await store.save({ key: 'a', name: 'A', slotData: tree() });
	setLocation('cloud');
	rig.signedIn = false;
	assert.equal(store.available(), false, 'cloud without an account');
	await assert.rejects(() => store.save({ key: 'b', name: 'B', slotData: tree() }), (e) => e instanceof WorldItemError && e.code === 'unavailable');
	assert.equal((await store.find({ key: 'a' }))?.name, 'A', 'the device still answers');
	setPublication(null);
	assert.equal(store.available(), false, 'a draft has no world storage');
	assert.equal(await store.find({ key: 'a' }), null);
	assert.deepEqual(await store.list(), []);
	assert.equal(local.items.size, 1);
});

test('what is saved is limited and checked', async () => {
	const { store } = rig();
	for (const bad of [{ name: '', slotData: tree() }, { name: 'x', key: 'has space', slotData: tree() }, { name: 'x', slotData: [] }, { name: 'x'.repeat(WORLD_ITEM_LIMITS.maxNameLength + 1), slotData: tree() }]) {
		assert.throws(() => validateWorldItemInput(bad), WorldItemError);
	}
	for (let i = 0; i < WORLD_ITEM_LIMITS.maxItems; i++) await store.save({ key: `k${i}`, name: 'x', slotData: tree() });
	await assert.rejects(() => store.save({ key: 'one-more', name: 'x', slotData: tree() }), (e) => e.code === 'limit');
	await store.save({ key: 'k0', name: 'replaced', slotData: tree() });
});

test('a script saves the object at a slot, at the origin and without the external mark, under a key', async () => {
	const { store } = rig();
	const placed = [{ ...createSlot({ id: 'disc', name: 'Disc', position: [4, 1, 2], rotation: [0, 0.7071, 0, 0.7071] }), external: true }, { ...createSlot({ id: 'label', parentId: 'disc', name: 'Label' }), external: true }];
	const items = createScriptWorldItems(store, (id) => (id === 'disc' ? placed : null), () => true);
	assert.equal(items.available, true);
	assert.equal(await items.save('disc-1', 'disc', { name: 'My disc' }), true);
	const saved = await store.find({ key: 'disc-1' });
	assert.equal(saved.name, 'My disc');
	assert.deepEqual(saved.slotData[0].position, [0, 0, 0], 'where it stood is not part of it');
	assert.deepEqual(saved.slotData[0].rotation, [0, 0, 0, 1]);
	assert.equal(saved.slotData[0].parentId, null);
	assert.ok(saved.slotData.every((slot) => slot.external === undefined));
	assert.equal(await items.save('bad key!', 'disc'), false);
	assert.equal(await items.save('disc-2', 'nothing-here'), false);
	assert.deepEqual(await items.list(), [{ key: 'disc-1', name: 'My disc' }]);
	assert.equal(await items.has('disc-1'), true);
	assert.equal(await items.remove('disc-1'), true);
	assert.equal(await items.has('disc-1'), false);
});

test('a guest\'s script cannot reach the host\'s storage', async () => {
	const { store } = rig();
	const items = createScriptWorldItems(store, () => tree(), () => false);
	assert.equal(items.available, false);
	assert.equal(await items.save('k', 's0'), false);
	assert.deepEqual(await items.list(), []);
	assert.equal(await items.remove('k'), false);
});
