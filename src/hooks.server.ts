import type { Handle } from '@sveltejs/kit';
import { auth } from '$lib/auth';
import { getLocale } from '$lib/server/locale';
import { runWithLocale, loadLocales } from 'wuchale/load-utils/server';
import { locales } from './locales/data.js';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { allowedOrigin, corsHeaders, parseAllowedOrigins } from '$lib/server/cors';
import * as main from './locales/main.loader.server.svelte.js';

loadLocales(main.key, main.loadCount, main.loadCatalog, locales);

/** A game on another site may call the API with a bearer token if its origin is on the list (see lib/server/cors.ts). */
const engineOrigins = [...parseAllowedOrigins(env.ENGINE_ALLOWED_ORIGINS), ...(dev ? ['http://localhost:*', 'http://127.0.0.1:*', 'https://localhost:*'] : [])];

export const handle: Handle = async ({ event, resolve }) => {
	const origin = event.url.pathname.startsWith('/api/') ? allowedOrigin(event.request.headers.get('origin'), engineOrigins) : null;
	if (origin && event.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	const locale = getLocale(event.request);
	const response = await runWithLocale(locale, () => resolve(event));
	if (origin) for (const [name, value] of Object.entries(corsHeaders(origin))) response.headers.set(name, value);
	return response;
};
