import { EMPTY_COMPOSITION, getComposer, type Composition } from './composer.ts';
import { keyText, type KeyDef, type KeyboardLayout } from './layout.ts';

/**
 * What typing on the keyboard does to the text, as a pure function of the state and a key: the keyboard object only
 * draws the state and feeds keys in. Tested in Node.
 */

export type ShiftState = 'off' | 'once' | 'locked';

export interface EditorState {
	/** Committed text. */
	text: string;
	/** Where typing goes, in characters from the start of `text` (0 to its length). */
	cursor: number;
	composition: Composition;
	shift: ShiftState;
	page: string;
	maxLength?: number;
}

/** Something the keyboard has to do beyond changing the text. */
export type EditorEffect = 'submit' | 'close' | 'next-layout';

export interface EditorResult {
	state: EditorState;
	effect?: EditorEffect;
}

const characters = (text: string) => Array.from(text);

export function initialEditorState(layout: KeyboardLayout, text = '', maxLength?: number): EditorState {
	const chars = characters(text);
	const kept = maxLength === undefined ? chars : chars.slice(0, maxLength);
	return { text: kept.join(''), cursor: kept.length, composition: EMPTY_COMPOSITION, shift: 'off', page: layout.firstPage, maxLength };
}

/** The text as shown: what is still being composed sits at the cursor. */
export function shownText(state: EditorState): string {
	const chars = characters(state.text);
	return chars.slice(0, state.cursor).join('') + state.composition.preedit + chars.slice(state.cursor).join('');
}

/** `commit` typed at the cursor (as much of it as `maxLength` leaves room for), the cursor after it. */
function insert(state: EditorState, commit: string): Pick<EditorState, 'text' | 'cursor'> {
	const chars = characters(state.text);
	let added = characters(commit);
	if (state.maxLength !== undefined) added = added.slice(0, Math.max(0, state.maxLength - chars.length));
	if (!added.length) return { text: state.text, cursor: state.cursor };
	return { text: [...chars.slice(0, state.cursor), ...added, ...chars.slice(state.cursor)].join(''), cursor: state.cursor + added.length };
}

/** Whatever is being composed becomes text as it stands, at the cursor. */
function flushed(state: EditorState, layout: KeyboardLayout): EditorState {
	const result = getComposer(layout.composer).flush(state.composition);
	return { ...state, ...insert(state, result.commit), composition: result.composition };
}

/** A key was pressed (or, holding it, one of its `variant`s chosen). */
export function pressKey(state: EditorState, layout: KeyboardLayout, key: KeyDef, variant?: string): EditorResult {
	const composer = getComposer(layout.composer);
	switch (key.action) {
		case 'backspace': {
			const inComposition = composer.backspace(state.composition);
			if (inComposition.handled) return { state: { ...state, composition: inComposition.composition } };
			if (state.cursor === 0) return { state };
			const chars = characters(state.text);
			chars.splice(state.cursor - 1, 1);
			return { state: { ...state, text: chars.join(''), cursor: state.cursor - 1 } };
		}
		case 'left':
		case 'right': {
			// A composition is settled before the cursor moves away from it.
			const settled = flushed(state, layout);
			const step = key.action === 'left' ? -1 : 1;
			const cursor = Math.min(characters(settled.text).length, Math.max(0, settled.cursor + step));
			return { state: { ...settled, cursor } };
		}
		case 'enter':
			return { state: flushed(state, layout), effect: 'submit' };
		case 'close':
			return { state: flushed(state, layout), effect: 'close' };
		case 'shift':
			// Tap for one capital, tap again to lock, again to release.
			return { state: { ...state, shift: state.shift === 'off' ? 'once' : state.shift === 'once' ? 'locked' : 'off' } };
		case 'page':
			return { state: { ...state, page: key.page && layout.pages[key.page] ? key.page : state.page, shift: 'off' } };
		case 'layout':
			return { state: { ...flushed(state, layout), shift: 'off' }, effect: 'next-layout' };
		case 'space':
			return type(state, layout, ' ');
		default:
			if (key.text === undefined && variant === undefined) return { state };
			return type(state, layout, keyText(key, state.shift !== 'off', variant));
	}
}

function type(state: EditorState, layout: KeyboardLayout, text: string): EditorResult {
	const result = getComposer(layout.composer).type(state.composition, text);
	return {
		state: {
			...state,
			...insert(state, result.commit),
			composition: result.composition,
			shift: state.shift === 'once' ? 'off' : state.shift
		}
	};
}

/** A candidate was picked from the candidate bar. */
export function pickCandidate(state: EditorState, layout: KeyboardLayout, index: number): EditorResult {
	const result = getComposer(layout.composer).pick(state.composition, index);
	return { state: { ...state, ...insert(state, result.commit), composition: result.composition } };
}

/** Moves to another layout: whatever was being composed is kept as it stands, and the new layout starts on its first page. */
export function switchLayout(state: EditorState, from: KeyboardLayout, to: KeyboardLayout): EditorState {
	return { ...flushed(state, from), composition: EMPTY_COMPOSITION, shift: 'off', page: to.firstPage };
}
