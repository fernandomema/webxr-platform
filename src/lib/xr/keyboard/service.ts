import type { TransformNode } from '@babylonjs/core';
import type { KeyboardPresence } from './presence.ts';

/**
 * The one way anything asks for text in VR: the dash, a world's UI inputs, and later scripts. It brings the in-world
 * keyboard up near whoever asked; outside a headset there is no keyboard to bring up (a real one is used), and the
 * request answers null.
 */

export interface TextInputRequest {
	/** Shown at the start of the text bar, e.g. "Password". */
	title?: string;
	initial?: string;
	placeholder?: string;
	/** Shown as dots on the keyboard, and never sent anywhere else by it. */
	secret?: boolean;
	maxLength?: number;
	/** What asked for the text (a panel): the keyboard comes up between the player and it. */
	near?: TransformNode | null;
}

export interface TextInputHandlers {
	/** Every change, as it is typed. */
	onChange?(text: string): void;
	/** Enter was pressed; the keyboard goes away. */
	onSubmit?(text: string): void;
	/** The keyboard went away without enter: closed, or taken over by another request. */
	onClose?(text: string): void;
}

export interface TextInputSession {
	/** Puts the keyboard away (without calling `onSubmit`). */
	close(): void;
	/** Replaces the text, e.g. when the field was changed some other way. */
	setText(text: string): void;
}

export interface TextInputProvider {
	request(request: TextInputRequest, handlers: TextInputHandlers): TextInputSession | null;
	presence(): KeyboardPresence | null;
}

let provider: TextInputProvider | null = null;

/** Set by the engine once the keyboard can be shown (a headset session exists). */
export function setTextInputProvider(next: TextInputProvider | null): void {
	provider = next;
}

/** Brings the keyboard up for `request`. Null when there is none to bring up (not in a headset): type on a real one. */
export function requestTextInput(request: TextInputRequest, handlers: TextInputHandlers): TextInputSession | null {
	return provider?.request(request, handlers) ?? null;
}

/** Where this player's keyboard is, for the others to see a stand-in of it; null while it is put away. */
export function localKeyboardPresence(): KeyboardPresence | null {
	return provider?.presence() ?? null;
}
