import type { Handle } from '@sveltejs/kit';
import { auth } from '$lib/auth';
import { getLocale } from '$lib/server/locale';
import { runWithLocale, loadLocales } from 'wuchale/load-utils/server';
import { locales } from './locales/data.js';
import * as main from './locales/main.loader.server.svelte.js';

loadLocales(main.key, main.loadCount, main.loadCatalog, locales);

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	const locale = getLocale(event.request);
	return runWithLocale(locale, () => resolve(event));
};
