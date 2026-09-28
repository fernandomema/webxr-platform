import { browser } from '$app/environment';
import { loadLocale } from 'wuchale/load-utils';
import { locales } from '../locales/data.js';

// Registers the client-side Wuchale loader. The server catalog is loaded in
// hooks.server.ts, but the browser needs its own catalog before hydration.
import '../locales/main.loader.svelte.js';

function clientLocale(): string {
	if (!browser) return locales[0];

	const cookieLocale = document.cookie.match(/(?:^|;\s*)locale=([a-z-]+)/i)?.[1];
	const preferredLocale = cookieLocale ?? navigator.language.split('-')[0];
	return locales.includes(preferredLocale as (typeof locales)[number]) ? preferredLocale : locales[0];
}

export const load = async () => {
	if (browser) await loadLocale(clientLocale());
};
