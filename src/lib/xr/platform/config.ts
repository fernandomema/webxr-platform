/**
 * Where the engine finds the services it does not carry itself: the platform's API (accounts, credits, cloud assets,
 * hosted sessions), its signaling server and the static files it ships. Everything defaults to the site the page is served
 * from, which is what the platform's own site wants; a game served from elsewhere points them at the platform with
 * `configurePlatform` before it mounts the engine.
 */
export interface PlatformConfig {
	/** The origin of the platform's API, without a trailing slash. Empty means the page's own origin. */
	apiBase: string;
	/** A bearer token for the account in use, for a page that is not on the platform's origin and cannot share its cookie. */
	getToken: (() => string | null | undefined | Promise<string | null | undefined>) | null;
	/** Where the engine's static files (decoders, controller profiles, the base avatar, input icons) are served from. */
	assetBase: string;
	/** The signaling WebSocket. Empty means `/signaling` on the page's own origin. */
	signalingUrl: string;
	/** STUN servers for peer connections, separated by commas or spaces. */
	stunUrls: string;
	/** The page of the platform's website where credits are bought. */
	creditsPageUrl: string;
	/** The platform's name, as shown on the launch overlay. */
	name: string;
}

const defaults = (): PlatformConfig => ({
	apiBase: '',
	getToken: null,
	assetBase: '',
	signalingUrl: '',
	stunUrls: 'stun:stun.l.google.com:19302',
	creditsPageUrl: '/settings/credits',
	name: 'Kithin'
});

let current: PlatformConfig = defaults();
const listeners = new Set<() => void>();

export function configurePlatform(config: Partial<PlatformConfig>): void {
	const next = { ...current, ...config };
	next.apiBase = next.apiBase.replace(/\/+$/, '');
	next.assetBase = next.assetBase.replace(/\/+$/, '');
	current = next;
	for (const listener of listeners) listener();
}

export function getPlatformConfig(): Readonly<PlatformConfig> {
	return current;
}

/** Calls `listener` when the configuration changes. Returns a function that stops it. */
export function onPlatformConfigured(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Puts the configuration back to its defaults (for tests). */
export function resetPlatform(): void {
	current = defaults();
	for (const listener of listeners) listener();
}

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** The full address of a path on the platform's API (`/api/credits`). An absolute address is left as it is. */
export function platformUrl(path: string): string {
	return ABSOLUTE.test(path) ? path : `${current.apiBase}${path}`;
}

/** The address of one of the engine's static files (`/draco/…`). An absolute address is left as it is. */
export function assetUrl(path: string): string {
	return ABSOLUTE.test(path) ? path : `${current.assetBase}${path}`;
}

/** The signaling WebSocket address. */
export function signalingAddress(): string {
	if (current.signalingUrl) return current.signalingUrl;
	const base = current.apiBase || (typeof location !== 'undefined' ? location.origin : '');
	return `${base.replace(/^http/, 'ws')}/signaling`;
}

/**
 * `fetch` for the platform's API: the path is made absolute, and the request carries the account's session, as a cookie on the
 * platform's own origin and as a bearer token anywhere else. Requests to other addresses (a signed storage URL, the open web)
 * go through untouched.
 */
export async function platformFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
	if (typeof input !== 'string') return fetch(input, init);
	if (ABSOLUTE.test(input) && !input.startsWith(current.apiBase || '\0')) return fetch(input, init);
	const headers = new Headers(init.headers);
	const token = current.getToken ? await current.getToken() : null;
	if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
	return fetch(platformUrl(input), { ...init, headers, credentials: current.apiBase ? 'include' : (init.credentials ?? 'same-origin') });
}
