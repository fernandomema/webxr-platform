import { layoutProblems, type KeyboardLayout } from '../layout.ts';
import es from './es.json';
import en from './en.json';

/**
 * The keyboard layouts that can be typed with, in the order the layout key cycles through them. A new language is a
 * layout file imported here (or registered at runtime, e.g. with the composer it needs).
 */
const layouts = new Map<string, KeyboardLayout>();

export function registerLayout(layout: KeyboardLayout): void {
	const problems = layoutProblems(layout);
	if (problems.length) throw new Error(`Keyboard layout "${layout.id}": ${problems.join('; ')}`);
	layouts.set(layout.id, layout);
}

registerLayout(es as KeyboardLayout);
registerLayout(en as KeyboardLayout);

export const getLayout = (id: string): KeyboardLayout | undefined => layouts.get(id);
export const layoutIds = (): string[] => [...layouts.keys()];

/** The layout after `id` in the cycle of the layout key. */
export function nextLayout(id: string): KeyboardLayout {
	const ids = layoutIds();
	return layouts.get(ids[(ids.indexOf(id) + 1) % ids.length])!;
}

/** The layout to start with: the one last used if it still exists, else the one for the page's language, else the first. */
export function preferredLayout(lastUsed: string | null, language: string): KeyboardLayout {
	const code = language.toLowerCase().split('-')[0];
	return (lastUsed ? layouts.get(lastUsed) : undefined) ?? layouts.get(code) ?? layouts.values().next().value!;
}
