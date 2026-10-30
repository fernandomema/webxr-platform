import type { AbstractMesh, BaseTexture, PickingInfo } from '@babylonjs/core';
import { STICK_DEADZONE } from './pushPull.ts';

/**
 * Scrolling a panel with the stick: while a hand's laser points at something that scrolls (a list in a GUI panel, a
 * scrolling part of an HTML page), pushing that hand's stick forward or back scrolls it, instead of walking or turning.
 * GUI panels (an AdvancedDynamicTexture on the mesh) work on their own; any other surface registers itself.
 */
export interface StickScrollTarget {
	/** Whether something under the laser scrolls vertically (in either direction). */
	canScroll(pick: PickingInfo, pointerId: number | undefined): boolean;
	/** Scrolls what is under the laser by `dy` pixels of the surface: positive goes further down the content. */
	scrollBy(pick: PickingInfo, pointerId: number | undefined, dy: number): void;
}

const targets = new WeakMap<AbstractMesh, StickScrollTarget>();

/** Makes `mesh` scroll with the stick of a hand whose laser points at it. Returns a function that undoes it. */
export function registerStickScrollTarget(mesh: AbstractMesh, target: StickScrollTarget): () => void {
	targets.set(mesh, target);
	return () => {
		if (targets.get(mesh) === target) targets.delete(mesh);
	};
}

/** What the stick scrolls when the laser points at `mesh`: a registered surface, else the GUI drawn on it, else nothing. */
export function stickScrollTargetFor(mesh: AbstractMesh | null | undefined): StickScrollTarget | null {
	if (!mesh) return null;
	return targets.get(mesh) ?? guiTarget(mesh);
}

/** Full stick tilt scrolls this many surface pixels a second. */
export const STICK_SCROLL_MAX_SPEED = 1000;

/**
 * How fast a stick at `y` (forward reads negative) scrolls, in surface pixels a second: forward scrolls up, back
 * scrolls down, like a mouse wheel. It grows with the square of the tilt past the dead zone, so a light push reads
 * line by line and a full one flies through a long list. Pure.
 */
export function stickScrollSpeed(y: number): number {
	const tilt = Math.abs(y);
	if (tilt < STICK_DEADZONE) return 0;
	const t = Math.min(1, (tilt - STICK_DEADZONE) / (1 - STICK_DEADZONE));
	return Math.sign(y) * STICK_SCROLL_MAX_SPEED * t * t;
}

/** `idle`: the stick is centred. `scrolling`: it was pushed to scroll and scrolls until let go. `free`: it walks or turns as usual. */
export type StickScrollState = 'idle' | 'scrolling' | 'free';

export interface StickScrollStep {
	state: StickScrollState;
	/** The stick's forward/back is taken from walking, running and teleporting. */
	claimY: boolean;
	/** Its sideways is taken from stepping and turning too. */
	claimX: boolean;
}

/**
 * Who a hand's stick belongs to this frame. What it is pushed for is decided when it leaves the centre and holds until
 * it is let go, so a laser sweeping onto or off a panel never takes a stick that is already walking, nor hands a scroll
 * over to walking halfway. Pushed mostly forward or back while the laser points at something that scrolls, it scrolls;
 * pushed mostly sideways, it still turns. Centred over something that scrolls, forward/back is already reserved, so the
 * first frames of a scroll are not a step or a teleport aim. Pure.
 */
export function stepStickScroll(state: StickScrollState, x: number, y: number, overScrollable: boolean): StickScrollStep {
	const pushed = Math.abs(x) >= STICK_DEADZONE || Math.abs(y) >= STICK_DEADZONE;
	if (!pushed) return { state: 'idle', claimY: overScrollable, claimX: false };
	const next = state !== 'idle' ? state : overScrollable && Math.abs(y) >= Math.abs(x) ? 'scrolling' : 'free';
	return next === 'scrolling' ? { state: next, claimY: true, claimX: true } : { state: next, claimY: false, claimX: false };
}

// --- GUI panels -------------------------------------------------------------------------------------------------
// Duck-typed so this module does not load @babylonjs/gui. The fields used are Babylon internals (no public API says
// which control a pointer is over, nor how tall a scroll viewer's content is).

interface GuiControl {
	parent: GuiControl | null;
	isEnabled: boolean;
	getClassName(): string;
	_currentMeasure?: { height: number };
}

interface GuiScrollViewer extends GuiControl {
	isReadOnly: boolean;
	verticalBar: { isVisible: boolean; value: number; maximum: number };
	_window?: GuiControl;
	_clientHeight?: number;
}

interface GuiTexture extends BaseTexture {
	_lastControlOver?: Record<number, GuiControl | undefined>;
}

function guiTexture(mesh: AbstractMesh): GuiTexture | null {
	const textures = mesh.material?.getActiveTextures() ?? [];
	return (textures.find((texture) => texture.getClassName() === 'AdvancedDynamicTexture') as GuiTexture | undefined) ?? null;
}

/** The innermost scroll viewer with more content than fits, around the control the pointer is over. */
function scrollViewerUnder(texture: GuiTexture, pointerId: number | undefined): GuiScrollViewer | null {
	if (pointerId === undefined) return null;
	for (let control = texture._lastControlOver?.[pointerId]; control; control = control.parent ?? undefined) {
		if (control.getClassName() !== 'ScrollViewer') continue;
		const viewer = control as GuiScrollViewer;
		if (viewer.isEnabled && !viewer.isReadOnly && viewer.verticalBar.isVisible && overflowOf(viewer) > 0) return viewer;
	}
	return null;
}

/** How much taller the content is than the viewer's window, in texture pixels. */
function overflowOf(viewer: GuiScrollViewer): number {
	const content = viewer._window?._currentMeasure?.height ?? 0;
	const window = viewer._clientHeight ?? viewer._currentMeasure?.height ?? 0;
	return content - window;
}

function guiTarget(mesh: AbstractMesh): StickScrollTarget | null {
	const texture = guiTexture(mesh);
	if (!texture) return null;
	return {
		canScroll: (_pick, pointerId) => scrollViewerUnder(texture, pointerId) !== null,
		scrollBy(_pick, pointerId, dy) {
			const viewer = scrollViewerUnder(texture, pointerId);
			if (!viewer) return;
			// The bar's value is how far down the overflow the content is shown, from 0 to its maximum.
			const bar = viewer.verticalBar;
			bar.value = Math.min(bar.maximum, Math.max(0, bar.value + (dy / overflowOf(viewer)) * bar.maximum));
		}
	};
}
