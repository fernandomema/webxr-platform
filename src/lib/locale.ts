import { browser } from '$app/environment';
import { locales } from '../locales/data.js';

export type ClientLocale = (typeof locales)[number];

/** The language this browser uses: the `locale` cookie the site sets when someone chooses one, else the browser's, else the first the site offers. */
export function clientLocale(): ClientLocale {
	if (!browser) return locales[0];
	const cookieLocale = document.cookie.match(/(?:^|;\s*)locale=([a-z-]+)/i)?.[1];
	const preferredLocale = cookieLocale ?? navigator.language.split('-')[0];
	return locales.includes(preferredLocale as ClientLocale) ? (preferredLocale as ClientLocale) : locales[0];
}
