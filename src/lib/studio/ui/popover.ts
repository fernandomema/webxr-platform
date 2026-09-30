/**
 * Placement for the custom dropdowns. They are `position:absolute` inside the page (no native popups, which the XR
 * rasterizer cannot draw), so each one decides on open whether to open below or above its trigger and how tall it may be.
 */

export interface Placement {
	up: boolean;
	/** The tallest the popover may be without leaving the visible area. */
	maxHeight: number;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = parent.ownerDocument.defaultView!.getComputedStyle(parent);
		if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent;
	}
	return null;
}

/** Below the trigger unless there is clearly more room above. `desired` is the height the content would like. */
export function placePopover(trigger: HTMLElement, desired: number): Placement {
	const view = trigger.ownerDocument.defaultView!;
	const box = trigger.getBoundingClientRect();
	const bounds = scrollParent(trigger)?.getBoundingClientRect();
	const top = Math.max(0, bounds?.top ?? 0);
	const bottom = Math.min(view.innerHeight, bounds?.bottom ?? view.innerHeight);
	const below = bottom - box.bottom - 8;
	const above = box.top - top - 8;
	const up = below < Math.min(desired, 220) && above > below;
	return { up, maxHeight: Math.max(120, Math.min(desired, up ? above : below)) };
}
