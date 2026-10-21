/**
 * Games built on the engine can live on another site (or inside an app on a headset) and still use this platform's API with a
 * bearer token. A browser lets them only if the API says so, and only for the sites it knows: `ENGINE_ALLOWED_ORIGINS` is a
 * comma-separated list of origins (`https://mygame.example`), where a `*` stands for any host or port (`https://*.example.com`,
 * `http://localhost:*`).
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
	return (value ?? '').split(',').map((entry) => entry.trim().replace(/\/+$/, '')).filter(Boolean);
}

function matches(pattern: string, origin: string): boolean {
	if (!pattern.includes('*')) return pattern === origin;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
	return new RegExp(`^${escaped}$`).test(origin);
}

/** The origin to answer with, if this one may use the API; null for a site that is not on the list. */
export function allowedOrigin(origin: string | null, patterns: readonly string[]): string | null {
	if (!origin || origin === 'null') return null;
	return patterns.some((pattern) => matches(pattern, origin)) ? origin : null;
}

/** The headers that let `origin` call the API with a bearer token (no cookies cross sites, so credentials stay off). */
export function corsHeaders(origin: string): Record<string, string> {
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
		'access-control-allow-headers': 'authorization, content-type',
		'access-control-expose-headers': 'set-auth-token',
		'access-control-max-age': '600',
		vary: 'Origin'
	};
}
