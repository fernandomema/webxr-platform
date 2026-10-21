import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import { SANDBOX_PRELUDE } from './prelude';

/**
 * A QuickJS VM per code block. Code blocks are untrusted (anyone can publish a world), so their JavaScript never runs in the
 * page: it runs in here, where the only things that exist are the standard language and the `ctx` described by the host.
 * No window, document, fetch, cookies or storage — a script cannot reach the player's session, call our APIs on their
 * behalf, or draw over what the platform shows them.
 */

let moduleReady: QuickJSWASMModule | null = null;
let modulePromise: Promise<QuickJSWASMModule> | null = null;

/** Loads the WASM engine (once). `wasmLocation` is where the browser fetches `emscripten-module.wasm` from; Node finds it by itself. */
export function initCodeBlockSandbox(wasmLocation?: string): Promise<void> {
	modulePromise ??= newQuickJSWASMModuleFromVariant(wasmLocation ? newVariant(RELEASE_SYNC, { wasmLocation }) : RELEASE_SYNC).then((loaded) => (moduleReady = loaded));
	return modulePromise.then(() => undefined);
}

export const isCodeBlockSandboxReady = (): boolean => moduleReady !== null;

/** How a function's result reaches the script: `copy` as plain data, `live` as a handle to the host object, `list` as a copied array of live elements. */
export type ReturnMode = 'copy' | 'live' | 'list';

export interface VmLimits {
	memoryBytes: number;
	stackBytes: number;
	/** Wall-clock budget for the script's own code and its first run. */
	initMs: number;
	/** Wall-clock budget for each event, timer and per-frame call. */
	callMs: number;
}

/** The stack must stay well inside what the page itself has: past that the engine overflows the real stack, which its own check cannot catch. */
export const DEFAULT_VM_LIMITS: VmLimits = { memoryBytes: 64 * 1024 * 1024, stackBytes: 256 * 1024, initMs: 3000, callMs: 250 };

/** Consecutive calls that blow the budget before the block is shut down. */
const MAX_STRIKES = 5;
const MAX_TIMERS = 256;
const MAX_DEPTH = 40;
/** Names that would lead from a plain host object back to the host's constructors. */
const BLOCKED_KEYS = new Set(['constructor', '__proto__', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface FnEntry {
	fn: (...args: unknown[]) => unknown;
	mode: ReturnMode;
}
interface DescNode {
	k: 'fn' | 'get' | 'val' | 'obj';
	id?: number;
	v?: Json;
	p?: Record<string, DescNode>;
}
interface Bridge {
	init: QuickJSHandle;
	load: QuickJSHandle;
	invoke: QuickJSHandle;
	callFn: QuickJSHandle;
	settle: QuickJSHandle;
	fire: QuickJSHandle;
}

export interface CodeBlockVmOptions {
	/** The `ctx` the script receives: nested objects of functions (and getters), described to the VM and called back through the door. */
	api: Record<string, unknown>;
	/** Dotted path of an api function (`hierarchy.getSlot`) -> how its result reaches the script. Anything absent is `copy`. */
	returnModes?: Record<string, ReturnMode>;
	/** Where `console.*` from the script goes. */
	onConsole?: (level: 'log' | 'warn' | 'error', text: string) => void;
	/** A timer callback or a late callback threw. */
	onError?: (where: string, error: Error) => void;
	limits?: Partial<VmLimits>;
}

const isPlainData = (value: object): boolean => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;

/** What a script may read of a host object under `key`: own data of plain objects, and only methods/accessors of anything else. */
function findMember(obj: object, key: string): { found: boolean; value?: unknown } {
	if (BLOCKED_KEYS.has(key)) return { found: false };
	if (isPlainData(obj)) return Object.prototype.hasOwnProperty.call(obj, key) ? { found: true, value: (obj as Record<string, unknown>)[key] } : { found: false };
	for (let proto: object | null = obj; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
		const descriptor = Object.getOwnPropertyDescriptor(proto, key);
		if (!descriptor) continue;
		if (descriptor.get || typeof descriptor.value === 'function') return { found: true, value: (obj as Record<string, unknown>)[key] };
		return { found: false };
	}
	return { found: false };
}

export class CodeBlockVm {
	private readonly runtime: QuickJSRuntime;
	private readonly vm: QuickJSContext;
	private bridge: Bridge;
	private readonly limits: VmLimits;
	private readonly fnTable = new Map<number, FnEntry>();
	private readonly handles = new Map<number, object>();
	private readonly handleIds = new WeakMap<object, number>();
	private handleSeq = 0;
	private readonly hostPromises = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	private promiseSeq = 0;
	/** Promises of the VM that settled before the host had received them (they settle while the call that made them is being wrapped up). */
	private readonly settledEarly = new Map<number, { ok: boolean; value: unknown }>();
	private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
	private depth = 0;
	private deadline = 0;
	private strikes = 0;
	private disposed = false;
	private killed = false;
	private handlerNames = new Set<string>();

	constructor(private readonly options: CodeBlockVmOptions) {
		if (!moduleReady) throw new Error('The code block sandbox is not initialised');
		this.limits = { ...DEFAULT_VM_LIMITS, ...options.limits };
		this.runtime = moduleReady.newRuntime();
		this.runtime.setMemoryLimit(this.limits.memoryBytes);
		this.runtime.setMaxStackSize(this.limits.stackBytes);
		this.runtime.setInterruptHandler(() => this.deadline > 0 && Date.now() > this.deadline);
		this.vm = this.runtime.newContext();
		const door = this.vm.newFunction('H', (opHandle, payloadHandle) => {
			const result = this.onDoor(this.vm.getString(opHandle), this.vm.getString(payloadHandle));
			return this.vm.newString(result);
		});
		const preludeFn = this.vm.unwrapResult(this.vm.evalCode(SANDBOX_PRELUDE, 'sandbox-prelude.js'));
		const bridgeObject = this.vm.unwrapResult(this.vm.callFunction(preludeFn, this.vm.undefined, door));
		door.dispose();
		preludeFn.dispose();
		const take = (name: string) => this.vm.getProp(bridgeObject, name);
		this.bridge = { init: take('init'), load: take('load'), invoke: take('invoke'), callFn: take('callFn'), settle: take('settle'), fire: take('fire') };
		bridgeObject.dispose();
		const desc = this.describe(options.api, '');
		this.callBridge(this.bridge.init, this.limits.initMs, JSON.stringify(desc));
	}

	/** Compiles and runs the block's code once. Returns the names of the handlers it provided. Throws what the script threw. */
	load(code: string): string[] {
		const names = JSON.parse(this.callBridge(this.bridge.load, this.limits.initMs, code)) as string[];
		this.handlerNames = new Set(names);
		return names;
	}

	has(handler: string): boolean {
		return this.handlerNames.has(handler);
	}

	/** Calls a handler the script provided. Returns what it returned (a promise for an async handler). Throws what it threw. */
	invoke(handler: string, args: unknown[] = [], budgetMs = this.limits.callMs): unknown {
		if (this.disposed || this.killed) return undefined;
		const json = this.callBridge(this.bridge.invoke, budgetMs, handler, JSON.stringify(args.map((arg) => this.encode(arg, 'copy', 0))));
		return this.decode(JSON.parse(json) as Json);
	}

	get isKilled(): boolean {
		return this.killed;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.hostPromises.clear();
		this.settledEarly.clear();
		this.handles.clear();
		this.fnTable.clear();
		for (const handle of Object.values(this.bridge)) (handle as QuickJSHandle).dispose();
		this.vm.dispose();
		this.runtime.dispose();
	}

	// --- calling into the VM ---

	private callBridge(fn: QuickJSHandle, budgetMs: number, ...stringArgs: string[]): string {
		if (this.disposed) throw new Error('The code block was removed');
		if (this.killed) throw new Error('The code block was shut down');
		const outermost = this.depth === 0;
		if (outermost) this.deadline = Date.now() + budgetMs;
		this.depth += 1;
		const argHandles = stringArgs.map((arg) => this.vm.newString(arg));
		let result: ReturnType<QuickJSContext['callFunction']>;
		try {
			result = this.vm.callFunction(fn, this.vm.undefined, ...argHandles);
		} finally {
			for (const handle of argHandles) handle.dispose();
			this.depth -= 1;
		}
		try {
			if (result.error) {
				const dumped = this.vm.dump(result.error) as { name?: string; message?: string } | string;
				result.error.dispose();
				const message = typeof dumped === 'string' ? dumped : `${dumped?.name ?? 'Error'}: ${dumped?.message ?? ''}`;
				if (outermost && Date.now() > this.deadline) this.strike();
				throw new Error(message);
			}
			const text = this.vm.getString(result.value);
			result.value.dispose();
			if (outermost) this.strikes = 0;
			return text;
		} finally {
			if (outermost) {
				this.deadline = 0;
				this.drainJobs();
			}
		}
	}

	private strike(): void {
		this.strikes += 1;
		if (this.strikes >= MAX_STRIKES) {
			this.killed = true;
			this.options.onError?.('budget', new Error(`Shut down: ${MAX_STRIKES} calls in a row ran out of time`));
		}
	}

	/** Runs the continuations of the VM's promises (an `await` that was waiting for the host to answer). */
	private drainJobs(): void {
		if (this.disposed || this.depth > 0) return;
		this.deadline = Date.now() + this.limits.callMs;
		try {
			const result = this.runtime.executePendingJobs();
			if (result.error) {
				const dumped = this.vm.dump(result.error) as { message?: string } | string;
				result.error.dispose();
				this.options.onError?.('job', new Error(typeof dumped === 'string' ? dumped : String(dumped?.message ?? dumped)));
			}
		} finally {
			this.deadline = 0;
		}
	}

	private runInVm(where: string, fn: QuickJSHandle, budgetMs: number, ...args: string[]): void {
		try {
			this.callBridge(fn, budgetMs, ...args);
		} catch (error) {
			this.options.onError?.(where, error instanceof Error ? error : new Error(String(error)));
		}
	}

	private settleInVm(id: number, ok: boolean, value: Json): void {
		if (this.disposed || this.killed) return;
		const okHandle = ok ? this.vm.true : this.vm.false;
		if (this.depth === 0) this.deadline = Date.now() + this.limits.callMs;
		const idHandle = this.vm.newNumber(id);
		const valueHandle = this.vm.newString(JSON.stringify(value));
		try {
			this.depth += 1;
			const result = this.vm.callFunction(this.bridge.settle, this.vm.undefined, idHandle, okHandle, valueHandle);
			if (result.error) result.error.dispose();
			else result.value.dispose();
		} finally {
			this.depth -= 1;
			idHandle.dispose();
			valueHandle.dispose();
		}
		this.drainJobs();
	}

	// --- the door: calls from the VM into the host ---

	private onDoor(op: string, payloadJson: string): string {
		try {
			const payload = JSON.parse(payloadJson) as Record<string, unknown>;
			return JSON.stringify({ v: this.handleOp(op, payload) });
		} catch (error) {
			return JSON.stringify({ e: error instanceof Error ? error.message : String(error) });
		}
	}

	private handleOp(op: string, p: Record<string, unknown>): Json {
		switch (op) {
			case 'call': {
				const entry = this.fnTable.get(p.f as number);
				if (!entry) throw new Error('Unknown function');
				const args = (p.a as Json[]).map((arg) => this.decode(arg));
				return this.encode(entry.fn(...args), entry.mode, 0);
			}
			case 'get': {
				const obj = this.handleObject(p.h);
				const member = findMember(obj, String(p.k));
				if (!member.found) return { $x: 1 };
				if (typeof member.value === 'function') return { $m: 1 };
				return this.encode(member.value, 'live', 0);
			}
			case 'inv': {
				const obj = this.handleObject(p.h);
				const member = findMember(obj, String(p.k));
				if (!member.found || typeof member.value !== 'function') throw new Error(`${String(p.k)} is not a function`);
				const args = (p.a as Json[]).map((arg) => this.decode(arg));
				return this.encode((member.value as (...a: unknown[]) => unknown).apply(obj, args), 'copy', 0);
			}
			case 'has': {
				const obj = this.handleObject(p.h);
				return findMember(obj, String(p.k)).found;
			}
			case 'keys': {
				const obj = this.handleObject(p.h);
				return isPlainData(obj) ? Object.keys(obj).filter((key) => !BLOCKED_KEYS.has(key)) : [];
			}
			case 'set': {
				const obj = this.handleObject(p.h);
				const key = String(p.k);
				if (isPlainData(obj) && !BLOCKED_KEYS.has(key)) (obj as Record<string, unknown>)[key] = this.decode(p.v as Json);
				return null;
			}
			case 'del': {
				const obj = this.handleObject(p.h);
				const key = String(p.k);
				if (isPlainData(obj) && !BLOCKED_KEYS.has(key)) delete (obj as Record<string, unknown>)[key];
				return null;
			}
			case 'release': {
				const id = p.h as number;
				const obj = this.handles.get(id);
				if (obj) this.handleIds.delete(obj);
				this.handles.delete(id);
				return null;
			}
			case 'settle': {
				const waiting = this.hostPromises.get(p.p as number);
				if (!waiting) {
					this.settledEarly.set(p.p as number, { ok: Boolean(p.ok), value: p.ok ? this.decode(p.v as Json) : new Error(String(p.e)) });
					return null;
				}
				this.hostPromises.delete(p.p as number);
				if (p.ok) waiting.resolve(this.decode(p.v as Json));
				else waiting.reject(new Error(String(p.e)));
				return null;
			}
			case 'timer': {
				const id = p.id as number;
				if (this.timers.size >= MAX_TIMERS) throw new Error('Too many timers');
				const ms = Math.max(p.repeat ? 4 : 0, Math.min(Number(p.ms) || 0, 2 ** 31 - 1));
				const fire = () => {
					if (!p.repeat) this.timers.delete(id);
					this.runInVm('timer', this.bridge.fire, this.limits.callMs, String(id));
				};
				const handle = p.repeat ? setInterval(fire, ms) : setTimeout(fire, ms);
				this.timers.set(id, handle as ReturnType<typeof setTimeout>);
				return null;
			}
			case 'untimer': {
				const handle = this.timers.get(p.id as number);
				if (handle !== undefined) {
					clearTimeout(handle);
					clearInterval(handle as unknown as ReturnType<typeof setInterval>);
					this.timers.delete(p.id as number);
				}
				return null;
			}
			case 'console':
				this.options.onConsole?.(p.level as 'log' | 'warn' | 'error', String(p.text));
				return null;
			case 'uuid':
				return crypto.randomUUID();
			default:
				throw new Error(`Unknown operation ${op}`);
		}
	}

	private handleObject(id: unknown): object {
		const obj = typeof id === 'number' ? this.handles.get(id) : undefined;
		if (!obj) throw new Error('This object is no longer available');
		return obj;
	}

	private handleFor(obj: object): number {
		let id = this.handleIds.get(obj);
		if (id === undefined) {
			id = ++this.handleSeq;
			this.handleIds.set(obj, id);
			this.handles.set(id, obj);
		}
		return id;
	}

	// --- values across the door ---

	/** Host value -> JSON for the VM. */
	private encode(value: unknown, mode: ReturnMode, depth: number): Json {
		if (value === undefined) return { $u: 1 };
		if (value === null) return null;
		switch (typeof value) {
			case 'string':
			case 'boolean':
				return value;
			case 'number':
				return Number.isFinite(value) ? value : { $n: String(value) };
			case 'bigint':
				return Number(value);
			case 'symbol':
			case 'function':
				return { $u: 1 };
		}
		if (depth > MAX_DEPTH) throw new Error('Value is nested too deeply or contains a cycle');
		const object = value as object;
		if (typeof (object as { then?: unknown }).then === 'function') return this.encodePromise(object as PromiseLike<unknown>, mode);
		if (ArrayBuffer.isView(object)) return { $a: Array.from(object as unknown as ArrayLike<number>) };
		if (Array.isArray(object)) {
			if (mode === 'live') return { $h: this.handleFor(object), t: 'a' };
			const childMode: ReturnMode = mode === 'list' ? 'live' : mode;
			return { $a: object.map((item) => this.encode(item, childMode, depth + 1)) };
		}
		if (mode === 'live') return { $h: this.handleFor(object), t: 'o' };
		const out: { [key: string]: Json } = {};
		for (const key of Object.keys(object)) out[key] = this.encode((object as Record<string, unknown>)[key], mode, depth + 1);
		return { $o: out };
	}

	private encodePromise(promise: PromiseLike<unknown>, mode: ReturnMode): Json {
		const id = ++this.promiseSeq;
		promise.then(
			(value) => { try { this.settleInVm(id, true, this.encode(value, mode, 0)); } catch (error) { this.settleInVm(id, false, error instanceof Error ? error.message : String(error)); } },
			(error: unknown) => this.settleInVm(id, false, error instanceof Error ? error.message : String(error))
		);
		return { $p: id };
	}

	/** JSON from the VM -> host value. Functions become calls back into the VM; handles become the host objects they stand for. */
	private decode(x: Json): unknown {
		if (x === null || typeof x !== 'object') return x;
		const tagged = x as Record<string, unknown>;
		if (Array.isArray(x)) return x.map((item) => this.decode(item));
		if (tagged.$u !== undefined) return undefined;
		if (tagged.$n !== undefined) return Number(tagged.$n);
		if (tagged.$h !== undefined) return this.handleObject(tagged.$h);
		if (tagged.$a !== undefined) return (tagged.$a as Json[]).map((item) => this.decode(item));
		if (tagged.$o !== undefined) {
			const out: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(tagged.$o as Record<string, Json>)) if (key !== '__proto__') out[key] = this.decode(item);
			return out;
		}
		if (tagged.$f !== undefined) {
			const id = tagged.$f as number;
			return (...args: unknown[]) => this.decode(JSON.parse(this.callBridge(this.bridge.callFn, this.limits.callMs, String(id), JSON.stringify(args.map((arg) => this.encode(arg, 'copy', 0))))) as Json);
		}
		if (tagged.$p !== undefined) {
			const id = tagged.$p as number;
			const early = this.settledEarly.get(id);
			if (early) {
				this.settledEarly.delete(id);
				return early.ok ? Promise.resolve(early.value) : Promise.reject(early.value);
			}
			return new Promise((resolve, reject) => { this.hostPromises.set(id, { resolve, reject }); });
		}
		return x;
	}

	// --- describing ctx to the VM ---

	private describe(api: Record<string, unknown>, path: string): DescNode {
		const props: Record<string, DescNode> = {};
		for (const key of Object.keys(api)) {
			const childPath = path ? `${path}.${key}` : key;
			const descriptor = Object.getOwnPropertyDescriptor(api, key)!;
			const mode = this.options.returnModes?.[childPath] ?? 'copy';
			if (descriptor.get) {
				props[key] = { k: 'get', id: this.register(() => (api as Record<string, unknown>)[key], mode) };
			} else if (typeof descriptor.value === 'function') {
				const fn = descriptor.value as (...args: unknown[]) => unknown;
				props[key] = { k: 'fn', id: this.register((...args) => fn.apply(api, args), mode) };
			} else if (descriptor.value !== null && typeof descriptor.value === 'object' && !Array.isArray(descriptor.value)) {
				props[key] = this.describe(descriptor.value as Record<string, unknown>, childPath);
			} else {
				props[key] = { k: 'val', v: this.encode(descriptor.value, 'copy', 0) };
			}
		}
		return { k: 'obj', p: props };
	}

	private register(fn: (...args: unknown[]) => unknown, mode: ReturnMode): number {
		const id = this.fnTable.size + 1;
		this.fnTable.set(id, { fn, mode });
		return id;
	}
}
