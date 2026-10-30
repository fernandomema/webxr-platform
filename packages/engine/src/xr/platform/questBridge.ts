/**
 * The Meta Quest app is a Trusted Web Activity: the game is a web page, and around it is a small Android app. That app can use
 * the Horizon Platform SDK (the player's friends, who they are), which a web page cannot. Chrome lets the two talk through a
 * message channel (`postMessage` for TWAs, Chrome 115+), and this is the page's end of it.
 *
 * The app starts the conversation: once the page has loaded it posts a first message carrying a `MessagePort`. After that the
 * page asks and the app answers, one JSON message each way:
 *   page -> app   { id, method, params? }
 *   app -> page   { id, result } or { id, error }
 * Outside the Quest app no port ever arrives, `available` stays false and every request rejects, so callers just skip the feature.
 */

/** What the app can be asked. The proof is the SDK's user proof (a nonce) which the server checks with Meta. */
export interface QuestBridgeMethods {
	getLoggedInUser: { params: undefined; result: { id: string } };
	getUserProof: { params: undefined; result: { nonce: string } };
	getLoggedInUserFriends: { params: undefined; result: { ids: string[] } };
}

export type QuestBridgeMethod = keyof QuestBridgeMethods;

export class QuestBridgeError extends Error {}

/** The part of `window` the bridge needs (also what a test provides). */
export interface BridgeHost {
	addEventListener(type: 'message', listener: (event: { ports?: readonly MessagePortLike[]; data?: unknown }) => void): void;
	removeEventListener(type: 'message', listener: (event: { ports?: readonly MessagePortLike[]; data?: unknown }) => void): void;
}

export interface MessagePortLike {
	onmessage: ((event: { data: unknown }) => void) | null;
	postMessage(message: string): void;
}

export interface QuestBridge {
	/** Whether the app's port has arrived. */
	readonly available: boolean;
	request<M extends QuestBridgeMethod>(method: M, params?: QuestBridgeMethods[M]['params']): Promise<QuestBridgeMethods[M]['result']>;
	/** Resolves with whether the app answers, waiting up to `timeoutMs` for the port to arrive. */
	whenAvailable(timeoutMs?: number): Promise<boolean>;
	dispose(): void;
}

const REQUEST_TIMEOUT_MS = 15_000;

export function createQuestBridge(host: BridgeHost | null, options: { timeoutMs?: number } = {}): QuestBridge {
	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
	let port: MessagePortLike | null = null;
	let nextId = 1;
	const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
	const waiting = new Set<(available: boolean) => void>();

	const onPortMessage = ({ data }: { data: unknown }) => {
		let message: { id?: unknown; result?: unknown; error?: unknown } | null = null;
		try { message = typeof data === 'string' ? JSON.parse(data) : (data as typeof message); } catch { return; }
		if (!message || typeof message.id !== 'number') return;
		const call = pending.get(message.id);
		if (!call) return;
		pending.delete(message.id);
		clearTimeout(call.timer);
		if (typeof message.error === 'string') call.reject(new QuestBridgeError(message.error));
		else call.resolve(message.result);
	};

	const onHostMessage = (event: { ports?: readonly MessagePortLike[] }) => {
		const first = event.ports?.[0];
		if (!first || first === port) return;
		port = first;
		port.onmessage = onPortMessage;
		for (const resolve of waiting) resolve(true);
		waiting.clear();
	};
	host?.addEventListener('message', onHostMessage);

	return {
		get available() { return port !== null; },
		request(method, params) {
			const active = port;
			if (!active) return Promise.reject(new QuestBridgeError('The Quest app is not available'));
			const id = nextId++;
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new QuestBridgeError('The Quest app did not answer'));
				}, timeoutMs);
				pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
				active.postMessage(JSON.stringify({ id, method, params }));
			});
		},
		whenAvailable(wait = 0) {
			if (port) return Promise.resolve(true);
			if (wait <= 0) return Promise.resolve(false);
			return new Promise((resolve) => {
				const done = (available: boolean) => { clearTimeout(timer); waiting.delete(done); resolve(available); };
				const timer = setTimeout(() => done(false), wait);
				waiting.add(done);
			});
		},
		dispose() {
			host?.removeEventListener('message', onHostMessage);
			if (port) port.onmessage = null;
			port = null;
			for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new QuestBridgeError('The bridge was closed')); }
			pending.clear();
			for (const resolve of waiting) resolve(false);
			waiting.clear();
		}
	};
}

let shared: QuestBridge | null = null;

/** The page's bridge to the Quest app, set up the first time it is asked for (listening early matters: the app sends its port once). */
export function questBridge(): QuestBridge {
	shared ??= createQuestBridge(typeof window === 'undefined' ? null : (window as unknown as BridgeHost));
	return shared;
}
