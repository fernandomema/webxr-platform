import type { SlotTree } from '$lib/ecs/types';
import { DEFAULT_DASHBOARD_LAYOUT, normalizeDashboardLayout, type DashboardItemId } from './dashboardLayout';

export type MovementMode = 'teleport' | 'smooth';
export type RotationMode = 'smooth' | 'snap-45' | 'snap-90';
/** How much less detail the edges of the view get in a headset, for speed (fixed foveated rendering). */
export type FoveationLevel = 'off' | 'medium' | 'high';
export const FOVEATION: Record<FoveationLevel, number> = { off: 0, medium: 0.5, high: 1 };

export interface XrSettings {
	movementMode: MovementMode;
	rotationMode: RotationMode;
	/** The avatar worn on entering any world, as a copy of the inventory item chosen. Null uses the built-in one. */
	defaultAvatar: SlotTree | null;
	/** Where that copy came from (`adapterId:itemId`), so the inventory can show which avatar is worn. Null when none is chosen. */
	defaultAvatarSource: string | null;
	/** Sitting down: the head is lifted to standing height (1.7 m) so the avatar and the world behave as if you stood. */
	seatedMode: boolean;
	/** Which buttons the Home tab of the personal menu shows, in order. */
	dashboardLayout: DashboardItemId[];
	/** The in-world keyboard's layout last typed with (see keyboard/layouts). Null picks the page's language. */
	keyboardLayout: string | null;
	foveation: FoveationLevel;
	/** A small readout of frames per second, draw calls and meshes drawn, to see what a world costs. */
	showPerformance: boolean;
	/** Both eyes drawn by each draw call (WebXR layers + multiview), where the headset supports it. Takes effect on entering VR. */
	multiview: boolean;
	/** Frames per second asked of the headset's display (one it lists as supported). Null keeps the headset's own. */
	frameRate: number | null;
}

export const xrSettings: XrSettings = {
	movementMode: 'teleport',
	rotationMode: 'snap-45',
	defaultAvatar: null,
	defaultAvatarSource: null,
	seatedMode: false,
	dashboardLayout: [...DEFAULT_DASHBOARD_LAYOUT],
	keyboardLayout: null,
	foveation: 'high',
	showPerformance: false,
	multiview: false,
	frameRate: null
};

const STORAGE_KEY = 'webxr-platform-settings';

/** Call once at mount, before anything reads `xrSettings`. */
export function loadSettings(): void {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Partial<XrSettings>;
		if (parsed.movementMode) xrSettings.movementMode = parsed.movementMode;
		if (parsed.rotationMode) xrSettings.rotationMode = parsed.rotationMode;
		if (Array.isArray(parsed.defaultAvatar)) xrSettings.defaultAvatar = parsed.defaultAvatar;
		if (typeof parsed.defaultAvatarSource === 'string' && xrSettings.defaultAvatar) xrSettings.defaultAvatarSource = parsed.defaultAvatarSource;
		if (typeof parsed.seatedMode === 'boolean') xrSettings.seatedMode = parsed.seatedMode;
		if (parsed.dashboardLayout !== undefined) xrSettings.dashboardLayout = normalizeDashboardLayout(parsed.dashboardLayout);
		if (typeof parsed.keyboardLayout === 'string') xrSettings.keyboardLayout = parsed.keyboardLayout;
		if (parsed.foveation && parsed.foveation in FOVEATION) xrSettings.foveation = parsed.foveation;
		if (typeof parsed.showPerformance === 'boolean') xrSettings.showPerformance = parsed.showPerformance;
		if (typeof parsed.multiview === 'boolean') xrSettings.multiview = parsed.multiview;
		if (typeof parsed.frameRate === 'number' && parsed.frameRate > 0) xrSettings.frameRate = parsed.frameRate;
	} catch {
		// unavailable/malformed storage — keep defaults
	}
}

/** Call whenever a setting changes (see dashPanel.ts's Settings tab). */
export function saveSettings(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(xrSettings));
	} catch {
		// ignore — persistence is best-effort
	}
}
