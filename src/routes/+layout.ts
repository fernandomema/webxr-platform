import { browser } from '$app/environment';
import { loadLocale } from 'wuchale/load-utils';
import { clientLocale } from '$lib/locale';

// Registers the client-side Wuchale loader. The server catalog is loaded in
// hooks.server.ts, but the browser needs its own catalog before hydration.
import '../locales/main.loader.svelte.js';

export const load = async () => {
	if (browser) await loadLocale(clientLocale());
};
