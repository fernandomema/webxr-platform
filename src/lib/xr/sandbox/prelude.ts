/**
 * JavaScript that runs INSIDE the QuickJS VM before a code block's own code. It is a function expression taking `H`, the
 * only door out of the VM (`H(op, json) -> json`), and returns the bridge the host drives the block with.
 *
 * Values cross the door as JSON with a few tags: `$u` undefined, `$n` NaN/Infinity, `$f` a function of the sender,
 * `$h` a live handle to an object of the host (`t`: 'a' array, 'o' object), `$a` array, `$o` object, `$p` promise.
 * Objects of the world (slots, components) arrive as handles wrapped in Proxies, so scripts keep seeing and editing the real
 * thing; everything else is copied. Nothing of the page (window, fetch, document, cookies) exists in here.
 */
export const SANDBOX_PRELUDE = `(function (H) {
'use strict';
const parse = JSON.parse;
const str = JSON.stringify;
const MAX_FNS = 2048;
const fns = new Map();
let fnSeq = 0;
const pending = new Map();
let pendingSeq = 0;
const proxies = new Map();
const proxyIds = new WeakMap();
const timers = new Map();
let timerSeq = 0;
let handlers = {};

const registry = new FinalizationRegistry((id) => {
	const ref = proxies.get(id);
	if (ref && ref.deref()) return;
	proxies.delete(id);
	try { H('release', str({ h: id })); } catch (e) {}
});

function callRaw(op, payload) {
	const r = parse(H(op, str(payload)));
	if (r.e !== undefined) throw new Error(r.e);
	return r.v;
}

function errorMessage(e) {
	return e && e.message !== undefined ? String(e.message) : String(e);
}

function enc(v, depth) {
	if (v === undefined) return { $u: 1 };
	if (v === null) return null;
	const t = typeof v;
	if (t === 'string' || t === 'boolean') return v;
	if (t === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
	if (t === 'bigint') return Number(v);
	if (t === 'symbol') return { $u: 1 };
	if (t === 'function') {
		const id = ++fnSeq;
		fns.set(id, v);
		if (fns.size > MAX_FNS) fns.delete(fns.keys().next().value);
		return { $f: id };
	}
	const d = depth | 0;
	if (d > 40) throw new Error('Value is nested too deeply or contains a cycle');
	const hid = proxyIds.get(v);
	if (hid !== undefined) return { $h: hid };
	if (Array.isArray(v)) {
		const out = new Array(v.length);
		for (let i = 0; i < v.length; i++) out[i] = enc(v[i], d + 1);
		return { $a: out };
	}
	if (typeof v.then === 'function') return encPromise(v);
	const o = {};
	for (const k of Object.keys(v)) o[k] = enc(v[k], d + 1);
	return { $o: o };
}

function encPromise(p) {
	const id = ++pendingSeq;
	p.then(
		(x) => { H('settle', str({ p: id, ok: true, v: enc(x, 0) })); },
		(e) => { H('settle', str({ p: id, ok: false, e: errorMessage(e) })); }
	);
	return { $p: id };
}

function dec(x) {
	if (x === null || typeof x !== 'object') return x;
	if (x.$u !== undefined) return undefined;
	if (x.$n !== undefined) return Number(x.$n);
	if (x.$h !== undefined) return proxyFor(x.$h, x.t);
	if (x.$a !== undefined) return x.$a.map(dec);
	if (x.$o !== undefined) {
		const o = {};
		for (const k in x.$o) if (k !== '__proto__') o[k] = dec(x.$o[k]);
		return o;
	}
	if (x.$p !== undefined) return new Promise((resolve, reject) => { pending.set(x.$p, { resolve, reject }); });
	return x;
}

function isIndex(key) {
	const n = Number(key);
	return Number.isInteger(n) && n >= 0 && String(n) === key;
}

function proxyFor(id, t) {
	const cached = proxies.get(id);
	const existing = cached && cached.deref();
	if (existing) return existing;
	const isArray = t === 'a';
	const target = isArray ? [] : {};
	const methods = new Map();
	const own = (key) => callRaw('has', { h: id, k: key });
	const handler = {
		get(tgt, key, receiver) {
			if (typeof key === 'symbol') return Reflect.get(tgt, key, receiver);
			if (isArray && key !== 'length' && !isIndex(key)) return Reflect.get(tgt, key, receiver);
			const raw = callRaw('get', { h: id, k: key });
			if (raw !== null && typeof raw === 'object') {
				if (raw.$x !== undefined) return Reflect.get(tgt, key, receiver);
				if (raw.$m !== undefined) {
					let fn = methods.get(key);
					if (!fn) {
						fn = function () {
							const args = new Array(arguments.length);
							for (let i = 0; i < args.length; i++) args[i] = enc(arguments[i], 0);
							return dec(callRaw('inv', { h: id, k: key, a: args }));
						};
						methods.set(key, fn);
					}
					return fn;
				}
			}
			return dec(raw);
		},
		set(tgt, key, value) {
			if (typeof key === 'symbol') return Reflect.set(tgt, key, value);
			callRaw('set', { h: id, k: key, v: enc(value, 0) });
			return true;
		},
		has(tgt, key) {
			if (typeof key === 'symbol') return Reflect.has(tgt, key);
			return own(key) === true || (isArray && key === 'length');
		},
		deleteProperty(tgt, key) {
			if (typeof key === 'symbol') return Reflect.deleteProperty(tgt, key);
			callRaw('del', { h: id, k: key });
			return true;
		},
		ownKeys() {
			const keys = callRaw('keys', { h: id });
			if (isArray) keys.push('length');
			return keys;
		},
		getOwnPropertyDescriptor(tgt, key) {
			if (typeof key === 'symbol') return Reflect.getOwnPropertyDescriptor(tgt, key);
			if (isArray && key === 'length') return { value: handler.get(tgt, 'length', tgt), writable: true, enumerable: false, configurable: false };
			if (own(key) !== true) return undefined;
			return { value: handler.get(tgt, key, tgt), writable: true, enumerable: true, configurable: true };
		},
		defineProperty(tgt, key, descriptor) {
			if (typeof key === 'symbol') return Reflect.defineProperty(tgt, key, descriptor);
			if ('value' in descriptor) callRaw('set', { h: id, k: key, v: enc(descriptor.value, 0) });
			return true;
		},
		setPrototypeOf() { return false; }
	};
	const proxy = new Proxy(target, handler);
	proxies.set(id, new WeakRef(proxy));
	proxyIds.set(proxy, id);
	registry.register(proxy, id);
	return proxy;
}

function build(node) {
	if (node.k === 'fn') {
		const id = node.id;
		return function () {
			const args = new Array(arguments.length);
			for (let i = 0; i < args.length; i++) args[i] = enc(arguments[i], 0);
			return dec(callRaw('call', { f: id, a: args }));
		};
	}
	if (node.k === 'val') return dec(node.v);
	const o = {};
	for (const key in node.p) {
		const child = node.p[key];
		if (child.k === 'get') {
			const id = child.id;
			Object.defineProperty(o, key, { enumerable: true, get() { return dec(callRaw('call', { f: id, a: [] })); } });
		} else {
			o[key] = build(child);
		}
	}
	return o;
}

// Pure vector helpers run in here: they are called in loops, and crossing the door for an addition would cost more than the addition.
function installMath(math) {
	math.vecAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
	math.vecSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	math.vecScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
	math.vecDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	math.vecCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	math.vecLength = (a) => Math.hypot(a[0], a[1], a[2]);
	math.vecNormalize = (a) => {
		const len = Math.hypot(a[0], a[1], a[2]) || 1;
		return [a[0] / len, a[1] / len, a[2] / len];
	};
}

function formatArg(a) {
	if (typeof a === 'string') return a;
	try { return str(a); } catch (e) { return String(a); }
}

function installGlobals() {
	const g = globalThis;
	const log = (level) => (...args) => { callRaw('console', { level, text: args.map(formatArg).join(' ') }); };
	g.console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error') };
	const addTimer = (repeat) => (fn, ms, ...extra) => {
		if (typeof fn !== 'function') return 0;
		const id = ++timerSeq;
		timers.set(id, { fn, extra, repeat });
		try { callRaw('timer', { id, ms: Number(ms) || 0, repeat }); } catch (e) { timers.delete(id); throw e; }
		return id;
	};
	const clear = (id) => { if (timers.delete(id)) callRaw('untimer', { id }); };
	g.setTimeout = addTimer(false);
	g.setInterval = addTimer(true);
	g.clearTimeout = clear;
	g.clearInterval = clear;
	g.queueMicrotask = (fn) => { Promise.resolve().then(fn); };
	const t0 = Date.now();
	g.performance = { now: () => Date.now() - t0 };
	g.structuredClone = (v) => (v === undefined ? v : parse(str(v)));
	g.crypto = {
		randomUUID: () => callRaw('uuid', {}),
		getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 4294967296); return arr; }
	};
}

installGlobals();

let ctx;

return {
	init(descJson) {
		ctx = build(parse(descJson));
		if (ctx.math) installMath(ctx.math);
	},
	load(code) {
		const factory = new Function('ctx', code);
		const made = factory(ctx);
		handlers = made !== null && typeof made === 'object' ? made : {};
		return str(Object.keys(handlers).filter((k) => typeof handlers[k] === 'function'));
	},
	invoke(name, argsJson) {
		const args = parse(argsJson).map(dec);
		return str(enc(handlers[name].apply(handlers, args), 0));
	},
	callFn(id, argsJson) {
		const fn = fns.get(Number(id));
		if (!fn) throw new Error('Function is no longer available');
		const args = parse(argsJson).map(dec);
		return str(enc(fn.apply(undefined, args), 0));
	},
	settle(id, ok, json) {
		const p = pending.get(id);
		if (!p) return;
		pending.delete(id);
		if (ok) p.resolve(dec(parse(json)));
		else p.reject(new Error(parse(json)));
	},
	fire(id) {
		const key = Number(id);
		const t = timers.get(key);
		if (!t) return;
		if (!t.repeat) timers.delete(key);
		t.fn.apply(undefined, t.extra);
	}
};
})`;
