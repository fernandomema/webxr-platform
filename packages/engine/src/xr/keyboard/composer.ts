/**
 * How typed keys become text. Most scripts are typed letter by letter ('direct'), but some are composed: with pinyin the
 * keys spell a syllable (the preedit) and the writer picks the character from a list of candidates. A composer is that
 * rule, kept out of the keyboard so a new one plugs in without changing it. Pure.
 */

export interface Composition {
	/** Typed but not yet turned into text: shown underlined after the text. */
	preedit: string;
	/** What the preedit could become, offered on the keyboard's candidate bar. */
	candidates: string[];
}

export interface ComposeResult {
	/** Text to add for good. */
	commit: string;
	composition: Composition;
}

export interface InputComposer {
	id: string;
	/** A key typed `text` (a character, or ' ' for the space bar). */
	type(composition: Composition, text: string): ComposeResult;
	/** Backspace: true when the composition used it (the preedit got shorter), false to let it delete committed text. */
	backspace(composition: Composition): { handled: boolean; composition: Composition };
	/** A candidate was picked from the bar. */
	pick(composition: Composition, index: number): ComposeResult;
	/** Whatever is pending becomes text as it stands (on enter, on closing, on switching layout). */
	flush(composition: Composition): ComposeResult;
}

export const EMPTY_COMPOSITION: Composition = { preedit: '', candidates: [] };

/** Each key types exactly what it shows. */
export const directComposer: InputComposer = {
	id: 'direct',
	type: (composition, text) => ({ commit: text, composition }),
	backspace: (composition) => ({ handled: false, composition }),
	pick: (composition) => ({ commit: '', composition }),
	flush: () => ({ commit: '', composition: EMPTY_COMPOSITION })
};

const composers = new Map<string, InputComposer>([[directComposer.id, directComposer]]);

/** Makes a composer available to layouts that name it (e.g. a pinyin composer, loaded with its dictionary). */
export function registerComposer(composer: InputComposer): void {
	composers.set(composer.id, composer);
}

/** The composer a layout asks for; the direct one when it asks for none, or for one that is not loaded. */
export function getComposer(id: string | undefined): InputComposer {
	return composers.get(id ?? 'direct') ?? directComposer;
}
