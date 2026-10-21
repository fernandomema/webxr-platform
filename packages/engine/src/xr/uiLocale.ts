import { iconsAsWords, resolveInputHints, type InputDevice } from './inputHints.ts';

/** What decides how a text reads for whoever is looking: their language, and the device they hold. */
export interface UiContext {
	locale: string;
	device: InputDevice;
}

/** The text a UI element shows to someone who reads `locale`: its translation when it has one, otherwise its own `text`. */
export function localizedText(component: { text?: string; translations?: Record<string, { text?: string }> }, locale: string | undefined): string | undefined {
	const translated = locale ? component.translations?.[locale]?.text : undefined;
	return typeof translated === 'string' ? translated : component.text;
}

/** `localizedText` with the names of controls (`{dash}`, `{use}`…) written as the ones of the device in hand. */
export function uiText(component: { text?: string; translations?: Record<string, { text?: string }> }, context: UiContext | undefined): string | undefined {
	const text = localizedText(component, context?.locale);
	return text === undefined || !context ? text : resolveInputHints(text, context.locale, context.device);
}

/** `uiText` for an element that cannot draw pictures in its text: they are written as words. */
export function plainUiText(component: { text?: string; translations?: Record<string, { text?: string }> }, context: UiContext | undefined): string | undefined {
	const text = uiText(component, context);
	return text === undefined ? text : iconsAsWords(text);
}
