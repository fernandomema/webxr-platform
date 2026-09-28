import { locales } from '../../locales/data.js';

export type Locale = (typeof locales)[number];

export function getLocale(request: Request): Locale {
	const cookie = request.headers.get('cookie') || '';
	const match = cookie.match(/(?:^|;\s*)locale=([a-z-]+)/i);
	if (match && locales.includes(match[1] as Locale)) return match[1] as Locale;

	const preferred = request.headers.get('accept-language')?.split(',')[0]?.split('-')[0];
	if (preferred && locales.includes(preferred as Locale)) return preferred as Locale;

	return 'es';
}
