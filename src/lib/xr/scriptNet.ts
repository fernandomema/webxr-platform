export interface ScriptNetOptions {
	/**
	 * Routes of our own site this script may call with the player's session. None by default: scripts are untrusted and those
	 * requests carry cookies (account, credits, payments, admin…). The game grants a route only to the scripts it ships itself.
	 */
	sameOriginPaths?: readonly string[];
}

function isAllowedSameOriginPath(pathname: string, allowed: readonly string[]): boolean {
	return allowed.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** JSON requests for scripts: external HTTPS endpoints, and only the routes of our own site the script was granted. */
export async function requestScriptJson(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown, options: ScriptNetOptions = {}): Promise<unknown> {
	const origin = globalThis.location?.origin;
	const parsed = new URL(url, origin);
	const sameOrigin = Boolean(origin) && parsed.origin === origin;
	if (parsed.protocol !== 'https:' && !(sameOrigin && parsed.protocol === 'http:')) {
		throw new Error('Script requests require HTTPS or a same-origin URL');
	}
	if (sameOrigin && !isAllowedSameOriginPath(parsed.pathname, options.sameOriginPaths ?? [])) {
		throw new Error('Script requests to this route are not allowed');
	}
	const response = await fetch(parsed.href, {
		method,
		credentials: sameOrigin ? 'same-origin' : 'omit',
		headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
		...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(15000)
	});
	if (!response.ok) {
		const detail = await response.json().then((value) => String(value.message ?? value.error ?? '').split('\n')[0].slice(0, 120), () => '');
		throw new Error(detail || `HTTP ${response.status} from ${parsed.host}`);
	}
	return response.json();
}
