/**
 * The game hears the keyboard through its canvas (Babylon listens there), so keys only move the player while the canvas
 * has the focus. A web page shown in the world (an `htmlView` iframe) can end up with the focus, or leave it nowhere;
 * these helpers hand such keys to the canvas, unless they are meant for a field being typed into.
 */

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function isEditable(target: EventTarget | null): boolean {
	const element = target as Element | null;
	return typeof element?.closest === 'function' && element.closest(EDITABLE) !== null;
}

/** Sends a copy of `event` to `canvas`. Babylon reads the legacy `keyCode`, which a constructed event cannot be given, so it is added. */
export function forwardKeyTo(canvas: HTMLElement, event: KeyboardEvent): void {
	const copy = new KeyboardEvent(event.type, {
		key: event.key,
		code: event.code,
		location: event.location,
		repeat: event.repeat,
		ctrlKey: event.ctrlKey,
		shiftKey: event.shiftKey,
		altKey: event.altKey,
		metaKey: event.metaKey,
		bubbles: true,
		cancelable: true
	});
	Object.defineProperty(copy, 'keyCode', { get: () => event.keyCode });
	Object.defineProperty(copy, 'which', { get: () => event.which });
	canvas.dispatchEvent(copy);
}
