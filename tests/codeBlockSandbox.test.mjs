import assert from 'node:assert/strict';
import test from 'node:test';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';
import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Runs `code` as a code block on a fake host; scripts report with ctx.log and the test reads the debug log. */
function run(code, { slots = {}, host: hostOverrides = {} } = {}) {
	const scene = new Scene(new NullEngine());
	const node = new TransformNode('self', scene);
	const calls = [];
	const host = {
		getSlot: (id) => slots[id], getNode: () => node, getChildren: (parent) => Object.values(slots).filter((s) => s.parentId === parent), allSlots: () => Object.values(slots),
		getGrabbers: () => [], isHost: () => true, requestSpawn: (slot) => calls.push(['spawn', slot]), requestDelete() {},
		setComponentField: (...args) => calls.push(['field', ...args]),
		...hostOverrides
	};
	const runtime = createCodeBlockHandlers('self', node, code, host);
	const logs = () => runtime.getDebugLog().map((entry) => entry.message);
	const errors = () => runtime.getDebugLog().filter((entry) => entry.level === 'error').map((entry) => entry.message);
	return { runtime, logs, errors, calls, slots };
}

const slotFixture = () => ({
	a: { id: 'a', parentId: null, name: 'Alpha', position: [1, 2, 3], components: [{ type: 'grabbable', scalable: true }, { type: 'scriptState', data: { n: 1 } }] },
	b: { id: 'b', parentId: 'a', name: 'Beta', position: [0, 0, 0], components: [] }
});

test('a script sees none of the page: no window, document, fetch, storage, process or require', () => {
	const { logs, errors } = run(`
		const names = ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'location', 'process', 'require', 'importScripts', 'Worker', 'EventSource', 'Image', 'caches', 'cookieStore', 'parent', 'top', 'frames', 'postMessage', 'open'];
		ctx.log(JSON.stringify(names.filter((name) => typeof globalThis[name] !== 'undefined')));
		ctx.log(String(typeof globalThis.self), String(typeof globalThis.global));
		return {};
	`);
	assert.deepEqual(errors(), []);
	assert.equal(logs()[0], '[]');
});

test('the standard language is there: Function, eval, Promise, Map, typed arrays, Date, Math, JSON', () => {
	const { logs, errors } = run(`
		const f = new Function('a', 'return a * 2');
		ctx.log(JSON.stringify([f(4), eval('1+2'), typeof Promise, new Map([[1, 2]]).get(1), new Float32Array(2).length, typeof Date.now(), Math.max(1, 2), encodeURIComponent('a b')]));
		return {};
	`);
	assert.deepEqual(errors(), []);
	assert.equal(logs()[0], '[8,3,"function",2,2,"number",2,"a%20b"]');
});

test('escaping through the objects of the world finds the sandbox’s own Function, never the page’s', () => {
	const { logs, errors } = run(`
		const slot = ctx.hierarchy.getSlot('a');
		const attempts = [
			() => slot.constructor,
			() => slot.__proto__,
			() => slot.components.constructor,
			() => slot.components[0].constructor,
			() => Object.getPrototypeOf(slot) === Object.prototype,
			() => ctx.storage.constructor,
			() => ctx.hierarchy.getSlot.constructor('return typeof window')(),
			() => (function () { return this; }).constructor('return typeof document')(),
			() => ({}).constructor.constructor('return typeof process')(),
			() => slot.hasOwnProperty('name')
		];
		ctx.log(JSON.stringify(attempts.map((attempt) => { try { const v = attempt(); return typeof v === 'function' ? 'fn' : (v === undefined ? 'undef' : v); } catch (e) { return 'threw'; } })));
		return {};
	`, { slots: slotFixture() });
	assert.deepEqual(errors(), []);
	const results = JSON.parse(logs()[0]);
	// Properties that lead to host constructors are not there; whatever Function a script reaches is the VM's.
	assert.equal(results[0] === 'undef' || results[0] === 'fn', true);
	assert.equal(results[1] !== 'fn', true);
	assert.deepEqual(results.slice(6, 9), ['undefined', 'undefined', 'undefined']);
	assert.equal(results[9], true);
});

test('objects of the world stay live: a script reads what changed after it asked, and edits the real thing', () => {
	const slots = slotFixture();
	const { logs, errors, runtime } = run(`
		const slot = ctx.hierarchy.getSlot('a');
		return { tick() {
			ctx.log(slot.name + ':' + slot.position.join(',') + ':' + slot.components.length);
			slot.name = 'Renamed';
			slot.position[1] = 20;
			slot.components.push({ type: 'tag', id: 'x' });
			slot.components.find((c) => c.type === 'scriptState').data.n += 1;
			delete slot.components[0].scalable;
		} };
	`, { slots });
	runtime.tick(0.016);
	assert.deepEqual(errors(), []);
	assert.equal(logs()[0], 'Alpha:1,2,3:2');
	assert.equal(slots.a.name, 'Renamed');
	assert.deepEqual(slots.a.position, [1, 20, 3]);
	assert.deepEqual(slots.a.components.map((c) => c.type), ['grabbable', 'scriptState', 'tag']);
	assert.equal(slots.a.components[1].data.n, 2);
	assert.equal('scalable' in slots.a.components[0], false);
	// Changed by the host, seen by the script on its next look at the same object.
	slots.a.name = 'FromHost';
	runtime.tick(0.016);
	assert.match(logs()[1], /^FromHost:/);
});

test('slots behave like the data they are: arrays, JSON, spread, iteration, identity', () => {
	const slots = slotFixture();
	const { logs, errors } = run(`
		const a = ctx.hierarchy.getSlot('a');
		const kids = ctx.hierarchy.getChildren('a');
		const out = [
			Array.isArray(a.components), Array.isArray(kids), kids.length, kids[0] === ctx.hierarchy.getSlot('b'),
			JSON.stringify(a) === JSON.stringify({ id: 'a', parentId: null, name: 'Alpha', position: [1, 2, 3], components: [{ type: 'grabbable', scalable: true }, { type: 'scriptState', data: { n: 1 } }] }),
			Object.keys(a).join(','), [...a.position].reverse().join(','), a.components.map((c) => c.type).join('+'),
			ctx.hierarchy.findByName('Beta').id, ctx.hierarchy.getParent('b').id, ctx.self.getSlot() === undefined, 'name' in a, 'nope' in a, ({ ...a.components[0] }).type
		];
		for (const c of a.components) out.push(c.type);
		ctx.log(JSON.stringify(out));
		return {};
	`, { slots });
	assert.deepEqual(errors(), []);
	assert.deepEqual(JSON.parse(logs()[0]), [true, true, 1, true, true, 'id,parentId,name,position,components', '3,2,1', 'grabbable+scriptState', 'b', 'a', true, true, false, 'grabbable', 'grabbable', 'scriptState']);
});

test('what the host returns as plain data is a copy, and what a script hands over reaches the host as plain data', () => {
	const { runtime, calls, errors } = run(`
		return { onSpawn() {
			ctx.world.spawn({ name: 'Crate', position: [1, 2, 3], components: [{ type: 'meshRenderer', nested: { deep: [1, { x: NaN }] }, none: undefined }] });
			ctx.world.setComponentField('s', 'ui', 'forged', { $h: 1, $f: 2, $o: { x: 1 } });
		} };
	`);
	assert.deepEqual(errors(), []);
	const spawn = calls.find((call) => call[0] === 'spawn')[1];
	assert.equal(spawn.name, 'Crate');
	assert.deepEqual(spawn.position, [1, 2, 3]);
	assert.equal(Number.isNaN(spawn.components[0].nested.deep[1].x), true);
	assert.equal('none' in spawn.components[0], true);
	assert.equal(typeof spawn.id, 'string');
	// A value shaped like the sandbox's own tags is data to the host, not a way to name its objects or functions.
	assert.deepEqual(calls.find((call) => call[0] === 'field').slice(1), ['s', 'ui', 'forged', { $h: 1, $f: 2, $o: { x: 1 } }, true]);
	runtime.dispose();
});

test('a script that never returns is cut off, and one that keeps doing it is shut down without touching the others', () => {
	const hog = run(`return { tick() { while (true) {} } };`);
	const fine = run(`return { tick() { fine++; } }; var fine = 0;`);
	for (let i = 0; i < 8; i++) { hog.runtime.tick(0.016); fine.runtime.tick(0.016); }
	assert.match(hog.errors()[0], /interrupted/i);
	assert.ok(hog.errors().some((message) => /Shut down/.test(message)), 'after repeated overruns it is switched off');
	assert.deepEqual(fine.errors(), []);
});

test('a script that spins forever while compiling does not hang the page', () => {
	const { errors } = run(`for (;;) {}`);
	assert.match(errors()[0], /interrupted/i);
});

test('a script that allocates without end, or recurses without end, fails alone', () => {
	const memory = run(`const hold = []; return { tick() { for (let i = 0; i < 1e9; i++) hold.push(new Array(1e5).fill(i)); } };`);
	memory.runtime.tick(0.016);
	assert.equal(memory.errors().length, 1);
	const stack = run(`const f = () => f(); return { tick() { f(); } };`);
	stack.runtime.tick(0.016);
	assert.match(stack.errors()[0], /stack|recursion/i);
	assert.equal(stack.runtime.dispose(), undefined);
	memory.runtime.dispose();
});

test('ctx.net cannot reach the player’s own session: other routes of this site are refused and fetch is never called', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'http://localhost:5173' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const fetched = [];
	t.mock.method(globalThis, 'fetch', async (url, options) => { fetched.push([String(url), options.credentials]); return Response.json({ ok: true }); });
	const { runtime, logs } = run(`
		return { async onSpawn() {
			for (const url of ['/api/account', '/api/credits/confirm', 'http://localhost:5173/api/admin/assets/gc']) {
				try { await ctx.net.postJson(url, {}); ctx.log('allowed ' + url); } catch (e) { ctx.log('refused ' + url); }
			}
			ctx.log(JSON.stringify(await ctx.net.fetchJson('https://example.com/data')));
		} };
	`);
	await tick();
	assert.deepEqual(logs(), ['refused /api/account', 'refused /api/credits/confirm', 'refused http://localhost:5173/api/admin/assets/gc', '{"ok":true}']);
	assert.deepEqual(fetched, [['https://example.com/data', 'omit']]);
	runtime.dispose();
});

test('async handlers: results reach the script, rejections are logged, and a late answer after removal is harmless', async () => {
	const { runtime, logs, errors } = run(`
		return {
			async onSpawn() { const players = await ctx.world.getPlayers(); ctx.log('players ' + players.length); throw new Error('late failure'); },
			async onGrab() { await new Promise((resolve) => setTimeout(resolve, 5)); ctx.log('after timer'); }
		};
	`, { host: { getPlayers: () => [{ id: 'p', name: 'P', role: 'host' }] } });
	await tick();
	assert.deepEqual(logs().slice(0, 1), ['players 1']);
	assert.match(errors()[0], /late failure/);
	runtime.onGrab();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.ok(logs().includes('after timer'));
	runtime.onGrab();
	runtime.dispose();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(logs().filter((message) => message === 'after timer').length, 1, 'timers die with the block');
});

test('timers: setTimeout, setInterval and their clears work, and stop with the block', async () => {
	const { runtime, logs } = run(`
		let n = 0;
		const interval = setInterval(() => { n++; ctx.log('tick ' + n); if (n === 3) clearInterval(interval); }, 5);
		const cancelled = setTimeout(() => ctx.log('never'), 5);
		clearTimeout(cancelled);
		setTimeout((a, b) => ctx.log('args ' + a + b), 1, 'x', 'y');
		return {};
	`);
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.deepEqual(logs().filter((message) => message !== 'args xy'), ['tick 1', 'tick 2', 'tick 3']);
	assert.ok(logs().includes('args xy'));
	runtime.dispose();
});

test('onTrigger answers synchronously, radial items call back into the script, and handlers that are absent stay absent', () => {
	const { runtime, logs, errors } = run(`
		let pulls = 0;
		return {
			onTrigger(e) { pulls++; return e.phase === 'press' ? false : undefined; },
			getRadialItems() { return [{ label: 'Pulls', isEnabled: () => pulls > 0, onSelect: () => ctx.log('selected ' + pulls) }]; }
		};
	`);
	assert.equal(runtime.tick, undefined);
	assert.equal(runtime.onGrab, undefined);
	assert.equal(runtime.onTrigger({ phase: 'press', value: 1 }), false);
	assert.equal(runtime.onTrigger({ phase: 'release', value: 0 }), undefined);
	const [item] = runtime.getRadialItems();
	assert.equal(item.label, 'Pulls');
	assert.equal(item.isEnabled(), true);
	item.onSelect();
	assert.deepEqual(logs(), ['selected 2']);
	assert.deepEqual(errors(), []);
});

test('console, crypto, performance and structuredClone exist; the vector helpers run inside', () => {
	const { logs, errors } = run(`
		console.log('hello', { a: 1 });
		const id = crypto.randomUUID();
		ctx.log(JSON.stringify([/^[0-9a-f-]{36}$/.test(id), performance.now() >= 0, structuredClone({ a: [1] }).a[0], ctx.math.vecAdd([1, 2, 3], [1, 1, 1]), ctx.math.vecNormalize([0, 0, 0]), ctx.math.vecCross([1, 0, 0], [0, 1, 0]), ctx.math.quatMultiply([0, 0, 0, 1], [0, 0, 0, 1])]));
		return {};
	`);
	assert.deepEqual(errors(), []);
	assert.deepEqual(JSON.parse(logs()[0]), [true, true, 1, [2, 3, 4], [0, 0, 0], [0, 0, 1], [0, 0, 0, 1]]);
});

test('storage handles and audio tracks are usable from the script, and expose only their methods', async () => {
	const store = new Map();
	const handle = { get available() { return true; }, get: async (key, fallback) => (store.has(key) ? store.get(key) : fallback), set: async (key, value) => { store.set(key, value); }, secret: 'hidden-from-nobody' };
	const { logs, errors, runtime } = run(`
		return { async onSpawn() {
			const mine = ctx.storage.world;
			await mine.set('coins', 5);
			ctx.log(JSON.stringify([ctx.storage.available, mine.available, await mine.get('coins', 0), await mine.get('none', 'dflt')]));
		} };
	`, { host: { storage: { available: true, world: handle, player: () => handle } } });
	await tick();
	assert.deepEqual(errors(), []);
	assert.equal(logs()[0], '[true,true,5,"dflt"]');
	runtime.dispose();
});

test('a class instance of the host can be called but its fields and internals cannot be read', async () => {
	class Service { constructor() { this.token = 'secret-token'; this.options = { cookie: 'c' }; } ping() { return 'pong'; } get ready() { return true; } }
	const service = new Service();
	const { logs, errors } = run(`
		return { async onSpawn() {
			const s = ctx.storage.world;
			ctx.log(JSON.stringify([s.ping(), s.ready, s.token === undefined, s.options === undefined, Object.keys(s).length, 'token' in s]));
		} };
	`, { host: { storage: { available: true, world: service, player: () => service } } });
	await tick();
	assert.deepEqual(errors(), []);
	assert.deepEqual(JSON.parse(logs()[0]), ['pong', true, true, true, 0, false]);
});

test('a broken script is reported and leaves a runtime that can be disposed; a missing sandbox leaves the block inert', () => {
	const { runtime, errors } = run(`throw new Error('broken');`);
	assert.match(errors()[0], /broken/);
	assert.doesNotThrow(() => runtime.dispose());
	const syntax = run(`return {`);
	assert.match(syntax.errors()[0], /SyntaxError|unexpected/i);
});

test('ctx.pay hands the request to the game and returns only its answer; a guest or a world without payments gets "unavailable"', async () => {
	const asked = [];
	const payments = {
		request: async (player, sku) => { asked.push(['request', player, sku]); return { ok: false, reason: 'declined' }; },
		owns: async (player, sku) => { asked.push(['owns', player, sku]); return sku === 'sword'; }
	};
	const code = `
		return { async onSpawn() {
			ctx.log(JSON.stringify([ctx.pay.available, await ctx.pay.request({ sku: 'sword' }), await ctx.pay.request({ sku: 'axe', player: { id: 'p2', name: 'Ana' } }), await ctx.pay.request({ sku: 'bow', player: 'p3' }), await ctx.pay.owns('sword'), await ctx.pay.owns('axe', 'p2'), await ctx.pay.request({ sku: 42 })]));
		} };
	`;
	const paying = run(code, { host: { payments } });
	await tick();
	assert.deepEqual(paying.errors(), []);
	assert.deepEqual(JSON.parse(paying.logs()[0]), [true, { ok: false, reason: 'declined' }, { ok: false, reason: 'declined' }, { ok: false, reason: 'declined' }, true, false, { ok: false, reason: 'unavailable' }]);
	assert.deepEqual(asked, [['request', undefined, 'sword'], ['request', 'p2', 'axe'], ['request', 'p3', 'bow'], ['owns', undefined, 'sword'], ['owns', 'p2', 'axe']]);
	const guest = run(code, { host: { payments, isHost: () => false } });
	await tick();
	assert.deepEqual(JSON.parse(guest.logs()[0]), [false, { ok: false, reason: 'unavailable' }, { ok: false, reason: 'unavailable' }, { ok: false, reason: 'unavailable' }, false, false, { ok: false, reason: 'unavailable' }]);
	assert.equal(asked.length, 5, 'a guest never reaches the payments');
	const none = run(code);
	await tick();
	assert.equal(JSON.parse(none.logs()[0])[0], false);
});

test('a script cannot reach the credits routes: not through ctx.net, and the sandbox has no fetch of its own', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'https://play.example' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const fetched = [];
	t.mock.method(globalThis, 'fetch', async (url) => { fetched.push(String(url)); return Response.json({}); });
	const { logs, errors } = run(`
		return { async onSpawn() {
			const tries = [];
			for (const path of ['/api/credits/challenge', '/api/credits/confirm', '/api/credits', '//play.example/api/credits/confirm', 'https://play.example/api/credits/confirm']) {
				try { await ctx.net.postJson(path, { token: 'x' }); tries.push('sent'); } catch (e) { tries.push('refused'); }
			}
			tries.push(typeof fetch, typeof XMLHttpRequest, typeof navigator);
			ctx.log(JSON.stringify(tries));
		} };
	`);
	await tick();
	assert.deepEqual(errors(), []);
	assert.deepEqual(JSON.parse(logs()[0]), ['refused', 'refused', 'refused', 'refused', 'refused', 'undefined', 'undefined', 'undefined']);
	assert.deepEqual(fetched, []);
});

test('only scripts the game grants a route to can call it: the grant follows the script’s source, not its name', async (t) => {
	const previous = globalThis.location;
	globalThis.location = { origin: 'https://play.example' };
	t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
	const fetched = [];
	t.mock.method(globalThis, 'fetch', async (url) => { fetched.push(String(url)); return Response.json({ items: [] }); });
	const shipped = `return { async onSpawn() { try { await ctx.net.fetchJson('/api/feedback'); ctx.log('feedback ok'); } catch (e) { ctx.log('feedback refused'); } try { await ctx.net.fetchJson('/api/account'); ctx.log('account ok'); } catch (e) { ctx.log('account refused'); } } };`;
	const sameOriginPathsFor = (code) => (code === shipped ? ['/api/feedback'] : []);
	const granted = run(shipped, { host: { sameOriginPathsFor } });
	const copy = run(shipped.replace('/api/feedback', '/api/feedback '), { host: { sameOriginPathsFor } });
	const ungoverned = run(shipped);
	await tick();
	assert.deepEqual(granted.logs(), ['feedback ok', 'account refused']);
	assert.deepEqual(copy.logs(), ['feedback refused', 'account refused'], 'a script that differs by one character is not the shipped one');
	assert.deepEqual(ungoverned.logs(), ['feedback refused', 'account refused']);
	assert.deepEqual(fetched, ['https://play.example/api/feedback']);
});
