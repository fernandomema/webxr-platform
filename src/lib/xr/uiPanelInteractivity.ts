import type { Slot } from '../ecs/types';

/** The kinds of control that answer to a pointer: a panel made only of the others just shows something. */
const PASSIVE_KINDS = new Set(['container', 'text', 'image']);

/**
 * Whether a panel's controls need the pointer. A panel with nothing to press (a picture, some text) is only a surface, so the
 * pointer treats it as part of the object it belongs to: a label picture on a disc is grabbed with the disc.
 */
export function hasInteractiveControls(slots: readonly Slot[]): boolean {
	return slots.some((slot) => slot.components.some((component) => component.type === 'uiElement' && !PASSIVE_KINDS.has(component.kind)));
}
