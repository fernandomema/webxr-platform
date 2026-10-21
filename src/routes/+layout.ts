import { browser } from '$app/environment';
import { loadLocale } from 'wuchale/load-utils';
import { clientLocale } from '$lib/locale';
import { setEngineLocale } from '$lib/xr/i18n/locale';

// Says where the platform's services are and what the site ships to the engine (see engineSetup.ts).
import '$lib/engineSetup';

// Registers the client-side Wuchale loader. The server catalog is loaded in
// hooks.server.ts, but the browser needs its own catalog before hydration.
import '../locales/main.loader.svelte.js';

export const load = async () => {
	if (browser) {
		const locale = clientLocale();
		await loadLocale(locale);
		// The engine picks its own language from the browser; the site's choice (its cookie) wins when someone made one.
		setEngineLocale(locale);
	}
};
