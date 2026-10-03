/** What the desktop controls tell the player on screen. The engine writes it; `DesktopHud.svelte` draws it. */

export type AimKind = 'none' | 'grab' | 'ui' | 'object';

export interface HudRadial {
	items: { label: string; enabled: boolean }[];
	/** The slice the pointer is on, or -1. */
	hovered: number;
	/** Where the pointer has been pushed to, in ring radii from the centre. */
	pointer: { x: number; y: number };
	/** Opened with a tap: stays open until a slice is clicked. */
	sticky: boolean;
}

export const desktopHud = $state({
	/** Desktop controls are in charge (a headset session is not running). */
	active: false,
	/** The mouse is captured for looking around. */
	locked: false,
	/** A panel (the personal menu, the inspector) fills the screen. */
	panelOpen: false,
	panelName: '',
	aim: { kind: 'none' as AimKind, label: '' },
	/** What the hand is carrying, if anything. */
	holding: null as { label: string; equipped: boolean; usable: boolean } | null,
	radial: null as HudRadial | null
});

export function resetDesktopHud(): void {
	desktopHud.active = false;
	desktopHud.locked = false;
	desktopHud.panelOpen = false;
	desktopHud.panelName = '';
	desktopHud.aim = { kind: 'none', label: '' };
	desktopHud.holding = null;
	desktopHud.radial = null;
}

/** What the on-screen buttons do; the engine fills them in. */
export const hudActions = {
	closePanel: () => {}
};
