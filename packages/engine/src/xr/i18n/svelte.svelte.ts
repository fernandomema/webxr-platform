import { onEngineLocaleChange, translate } from './locale.ts';

let version = $state(0);
onEngineLocaleChange(() => version++);

/** `translate` for a Svelte component: the text is drawn again when the language changes. */
export function t(source: string, params?: Record<string, string | number>): string {
	void version;
	return translate(source, params);
}
