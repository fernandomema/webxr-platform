import type { LoaderComponent, Slot } from '../ecs/types.ts';
import {
	EXTERNAL_LIMITS, ExternalItemError, externalSourceKey, instantiateExternal, normalizeExternalSource, validateExternalTree,
	type ExternalResolver, type ExternalSource
} from '../inventory/external.ts';

/** What a loader needs of the scene it is in. */
export interface LoaderHost {
	/** Only the host (or a solo player) reads and builds; the others receive what it built. */
	isHost(): boolean;
	/** Whether the owner's slot is on (it and everything above it). */
	isEnabled(): boolean;
	/** The sources of the loaders above this one, to catch an object that contains itself and one nested too deep. */
	ancestors(): string[];
	resolve: ExternalResolver;
	/** Builds the slots under the owner. False when refused (over budget). */
	load(ownerId: string, slots: Slot[]): boolean;
	/** Takes down what `load` built for the owner. */
	unload(ownerId: string): void;
}

export type LoaderStatus =
	| { state: 'idle' }
	| { state: 'loading' }
	| { state: 'ready'; slots: number }
	| { state: 'error'; code: ExternalItemError['code'] | 'budget'; message: string };

export interface LoaderBinding {
	tick(): void;
	sync(component: LoaderComponent): void;
	dispose(): void;
	readonly status: LoaderStatus;
}

/** A source that could not be reached is tried again after this long; one that does not exist, or is not allowed, is not. */
const RETRY_MS = 15_000;

const sourceOf = (component: LoaderComponent): ExternalSource | null => normalizeExternalSource(component);
const keyOf = (component: LoaderComponent): string => { const source = sourceOf(component); return source ? externalSourceKey(source) : ''; };

/**
 * Keeps the object a `loader` names built under its slot while the slot is enabled. It is asked for when the slot is first on and
 * taken down when it goes off. A failure leaves the slot as it is, empty, with the reason in `status`: the world goes on without it.
 */
export function setupLoader(ownerId: string, initial: LoaderComponent, host: LoaderHost, now: () => number = Date.now, onError: (ownerId: string, status: LoaderStatus) => void = (id, status) => console.warn(`[loader] ${id}`, status)): LoaderBinding {
	let current = initial;
	let status: LoaderStatus = { state: 'idle' };
	let request: AbortController | null = null;
	let built = false;
	let retryAt = 0;
	let disposed = false;

	const fail = (code: Extract<LoaderStatus, { state: 'error' }>['code'], message: string, retry: boolean) => {
		status = { state: 'error', code, message };
		retryAt = retry ? now() + RETRY_MS : Infinity;
		onError(ownerId, status);
	};

	const drop = () => {
		request?.abort();
		request = null;
		if (built) host.unload(ownerId);
		built = false;
		retryAt = 0;
		status = { state: 'idle' };
	};

	function start(source: ExternalSource): void {
		const key = externalSourceKey(source);
		const above = host.ancestors();
		if (above.includes(key)) return fail('cycle', 'The object would contain itself', false);
		if (above.length >= EXTERNAL_LIMITS.maxDepth) return fail('too-deep', `Objects may be nested ${EXTERNAL_LIMITS.maxDepth} deep at most`, false);
		const mine = new AbortController();
		request = mine;
		status = { state: 'loading' };
		host.resolve(source, mine.signal).then(
			(item) => {
				if (disposed || request !== mine) return;
				request = null;
				let slots: Slot[];
				try {
					slots = instantiateExternal(ownerId, validateExternalTree(item.slots), ownerId);
				} catch (error) {
					return fail(error instanceof ExternalItemError ? error.code : 'invalid-item', error instanceof Error ? error.message : 'Invalid object', false);
				}
				if (!host.isEnabled() || keyOf(current) !== key) { status = { state: 'idle' }; return; }
				if (!host.load(ownerId, slots)) return fail('budget', 'Too many objects are loaded already', false);
				built = true;
				status = { state: 'ready', slots: slots.length };
			},
			(error) => {
				if (disposed || request !== mine) return;
				request = null;
				const code = error instanceof ExternalItemError ? error.code : 'unavailable';
				fail(code, error instanceof Error ? error.message : 'Could not load the object', code === 'unavailable');
			}
		);
	}

	return {
		get status() { return status; },
		tick() {
			if (disposed || !host.isHost()) return;
			if (!host.isEnabled()) {
				if (built || request || status.state !== 'idle') drop();
				return;
			}
			if (built || request) return;
			if (status.state === 'error' && now() < retryAt) return;
			const source = sourceOf(current);
			if (!source) { status = { state: 'idle' }; return; }
			start(source);
		},
		sync(component) {
			const changed = keyOf(component) !== keyOf(current);
			current = component;
			if (changed) drop();
		},
		dispose() {
			disposed = true;
			drop();
		}
	};
}
