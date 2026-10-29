import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { takeRateToken } from '../rateLimit';

/** An error with the HTTP status the library routes answer with. Its message is safe to show to the person. */
export class LibraryError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

const USER_AGENT = 'Kithin-WebXR/0.1';
const MAX_REDIRECTS = 3;

/** In `allowedHosts`: any named host on the public internet (see `assertPublicHost`). For aggregators, whose files live on each provider's own domain. */
export const ANY_PUBLIC_HOST = '*';

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
	return allowedHosts.some((allowed) => {
		if (allowed === ANY_PUBLIC_HOST) return true;
		const pattern = allowed.toLowerCase();
		return pattern.startsWith('*.') ? hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1 : hostname === pattern;
	});
}

/**
 * The address a source's file may be fetched from: https, no credentials, the default port, a named host (never an IP address, so
 * nothing can aim the server at its own network) that is in the source's list. Throws a 502, since the address came from the source.
 */
export function assertAllowedUrl(value: string, allowedHosts: readonly string[]): URL {
	let url: URL;
	try { url = new URL(value); } catch { throw new LibraryError(502, 'The source returned an invalid address.'); }
	const hostname = url.hostname.toLowerCase();
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 || !hostAllowed(hostname, allowedHosts)) {
		throw new LibraryError(502, 'The source returned a file from an unexpected host.');
	}
	return url;
}

/** Whether an IP address is one a server may reach on behalf of a visitor: not loopback, private, link-local, shared, reserved or multicast. */
export function isPublicAddress(address: string): boolean {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	if (mapped) return isPublicAddress(mapped[1]);
	if (isIP(address) === 4) {
		const [a, b] = address.split('.').map(Number);
		if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
		if (a === 100 && b >= 64 && b <= 127) return false;
		if (a === 169 && b === 254) return false;
		if (a === 172 && b >= 16 && b <= 31) return false;
		if (a === 192 && (b === 168 || (b === 0 && address.startsWith('192.0.0.')))) return false;
		if (a === 198 && (b === 18 || b === 19)) return false;
		return true;
	}
	if (isIP(address) === 6) {
		const lower = address.toLowerCase();
		if (lower === '::' || lower === '::1') return false;
		const first = parseInt(lower.split(':')[0] || '0', 16);
		if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
		return true;
	}
	return false;
}

export type HostResolver = (hostname: string) => Promise<string[]>;
const resolveHost: HostResolver = async (hostname) => (await lookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * For a source that may use any host: the name has to resolve, and only to public addresses, so a name that points inside our network
 * is refused. The check is made before every request, including each redirect. (The request then resolves the name again, so a name
 * that changes answer in between is not covered; https, which needs a certificate for that name, makes it hard to exploit.)
 */
export async function assertPublicHost(hostname: string, resolver: HostResolver = resolveHost): Promise<void> {
	let addresses: string[];
	try { addresses = await resolver(hostname); } catch { throw new LibraryError(502, 'The source returned a file from a host that does not exist.'); }
	if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new LibraryError(502, 'The source returned a file from an unexpected host.');
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
	if (Number(response.headers.get('content-length') ?? 0) > limit) throw new LibraryError(413, 'This file is too large to import.');
	if (!response.body) throw new LibraryError(502, 'The source returned an empty file.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) { await reader.cancel(); throw new LibraryError(413, 'This file is too large to import.'); }
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

export interface FetchOptions {
	allowedHosts: readonly string[];
	maxBytes: number;
	timeoutMs?: number;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	/** How names are resolved when any public host is allowed; tests give their own. */
	resolver?: HostResolver;
}

/** Fetches under the host allowlist and a size cap. Redirects are followed by hand so every hop is checked again. */
export async function fetchLimited(value: string, options: FetchOptions): Promise<{ bytes: Uint8Array; contentType: string }> {
	const checked = async (address: string): Promise<URL> => {
		const found = assertAllowedUrl(address, options.allowedHosts);
		if (options.allowedHosts.includes(ANY_PUBLIC_HOST)) await assertPublicHost(found.hostname, options.resolver);
		return found;
	};
	let url = await checked(value);
	const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 30_000), ...(options.signal ? [options.signal] : [])]);
	for (let hop = 0; ; hop++) {
		const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...options.headers }, redirect: 'manual', signal });
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location || hop >= MAX_REDIRECTS) throw new LibraryError(502, 'The source redirected too many times.');
			await response.body?.cancel();
			url = await checked(new URL(location, url).href);
			continue;
		}
		if (response.status === 404) throw new LibraryError(404, 'The source does not have that.');
		if (response.status === 429) throw new LibraryError(503, 'The source is busy. Try again in a moment.');
		if (!response.ok) throw new LibraryError(502, `The source answered with HTTP ${response.status}.`);
		return { bytes: await readLimited(response, options.maxBytes), contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
	}
}

/** A small in-memory cache with an expiry and a size cap (the oldest entries go first). */
export class TtlCache<T> {
	private readonly entries = new Map<string, { until: number; value: T }>();
	constructor(private readonly ttlMs: number, private readonly maxEntries = 500) {}

	get(key: string, now = Date.now()): T | undefined {
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		if (entry.until <= now) { this.entries.delete(key); return undefined; }
		return entry.value;
	}

	set(key: string, value: T, now = Date.now()): void {
		this.entries.delete(key);
		this.entries.set(key, { until: now + this.ttlMs, value });
		while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
	}
}

/** Asks the cache, and otherwise runs `load` once however many callers want the same key at the same time. */
export function cachedLoader<T>(cache: TtlCache<T>) {
	const inflight = new Map<string, Promise<T>>();
	return (key: string, load: () => Promise<T>): Promise<T> => {
		const hit = cache.get(key);
		if (hit !== undefined) return Promise.resolve(hit);
		let pending = inflight.get(key);
		if (!pending) {
			pending = load().then((value) => { cache.set(key, value); return value; }).finally(() => inflight.delete(key));
			inflight.set(key, pending);
		}
		return pending;
	};
}

export interface JsonClientOptions {
	/** Every request is made under this address; its host is the only one allowed. */
	base: string;
	headers?: Record<string, string>;
	ttlMs?: number;
	timeoutMs?: number;
	maxBytes?: number;
	/** Requests a minute this process may send to the source: set a little under the source's own limit. */
	requestsPerMinute?: number;
	/** Names the limiter and the errors. */
	name: string;
}

/**
 * What most sources need to read an API: JSON over https under the source's host, answers cached for a few minutes, identical requests
 * merged, and a ceiling on how often the source is called. An adapter then only maps the JSON to the contract.
 */
export function createJsonClient(options: JsonClientOptions) {
	const base = new URL(options.base);
	const cache = new TtlCache<unknown>(options.ttlMs ?? 5 * 60_000);
	const load = cachedLoader(cache);
	return async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
		const url = new URL(path, base);
		if (url.host !== base.host) throw new LibraryError(502, 'The source returned an address outside itself.');
		return load(url.href, async () => {
			if (!takeRateToken(`library-source:${options.name}`, options.requestsPerMinute ?? 60)) throw new LibraryError(503, `${options.name} is busy. Try again in a moment.`);
			const { bytes } = await fetchLimited(url.href, { allowedHosts: [base.hostname], maxBytes: options.maxBytes ?? 4 * 1024 * 1024, timeoutMs: options.timeoutMs ?? 15_000, headers: { accept: 'application/json', ...options.headers }, signal });
			try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new LibraryError(502, `${options.name} returned an unreadable answer.`); }
		}) as Promise<T>;
	};
}
