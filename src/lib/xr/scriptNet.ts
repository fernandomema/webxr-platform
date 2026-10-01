/** JSON requests for scripts: local routes or external HTTPS endpoints. */
export async function requestScriptJson(url: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<unknown> {
	const origin = globalThis.location?.origin;
	const parsed = new URL(url, origin);
	if (parsed.protocol !== 'https:' && !(origin && parsed.origin === origin && parsed.protocol === 'http:')) {
		throw new Error('Script requests require HTTPS or a same-origin URL');
	}
	const response = await fetch(parsed.href, {
		method,
		credentials: parsed.origin === origin ? 'same-origin' : 'omit',
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
