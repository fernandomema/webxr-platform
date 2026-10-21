import es from './es.ts';

/**
 * The engine's own translations of the texts it shows (the launch screen, the desktop HUD…). Nothing has to be handed to it:
 * the texts are written in English in the code, `translate` looks each one up here by its English wording, and a text with no
 * translation is shown as written. The language is the one chosen with `setEngineLocale`, else the one the browser asks for.
 */
type Catalog = Record<string, string>;

const catalogs = new Map<string, Catalog>([['es', es]]);
const listeners = new Set<() => void>();
const STORAGE_KEY = 'kithin.engine.locale';

let override: string | null = null;
let detected: string | null = null;

function supported(code: string): string | null {
	const language = code.toLowerCase().split('-')[0];
	return language === 'en' || catalogs.has(language) ? language : null;
}

function detect(): string {
	try {
		const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
		if (stored && supported(stored)) return supported(stored)!;
	} catch {
		// Storage can be blocked; the browser's language is used then.
	}
	const asked = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
	for (const code of asked) if (code && supported(code)) return supported(code)!;
	return 'en';
}

/** The language the engine speaks now: a two-letter code such as `en` or `es`. */
export function engineLocale(): string {
	if (override) return override;
	return (detected ??= detect());
}

/** Chooses the language: a code the engine has a translation for, else English. `null` goes back to the browser's. */
export function setEngineLocale(locale: string | null): void {
	const next = locale === null ? null : (supported(locale) ?? 'en');
	if (next === override) return;
	override = next;
	if (locale === null) detected = null;
	for (const listener of listeners) listener();
}

/** Adds (or replaces) translations for a language, keyed by the English text. For an app that wants more languages. */
export function registerTranslations(locale: string, texts: Catalog): void {
	const language = locale.toLowerCase().split('-')[0];
	catalogs.set(language, { ...catalogs.get(language), ...texts });
	for (const listener of listeners) listener();
}

/** Calls `listener` when the language or the translations change. Returns a function that stops it. */
export function onEngineLocaleChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * The text in the engine's language. `{name}` in the text is replaced by `params.name`. The English wording is the key, so the
 * source reads as it will on screen and an untranslated text is simply shown in English.
 */
export function translate(source: string, params?: Record<string, string | number>): string {
	const text = catalogs.get(engineLocale())?.[source] ?? source;
	return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;
}
