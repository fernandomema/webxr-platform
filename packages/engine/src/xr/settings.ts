import type { SlotTree } from '../ecs/types.ts';
import type { WorldItemLocation } from '../worldStorage/items.ts';

export type MovementMode = 'teleport' | 'smooth';
export type RotationMode = 'smooth' | 'snap-45' | 'snap-90';
/** How much less detail the edges of the view get in a headset, for speed (fixed foveated rendering). */
export type FoveationLevel = 'off' | 'medium' | 'high';
export const FOVEATION: Record<FoveationLevel, number> = { off: 0, medium: 0.5, high: 1 };
/** How often world scripts run, as one frame in this many (see `XrSettings.scriptRate`). */
export const SCRIPT_RATES = [1, 2, 3, 4] as const;
export type ScriptRate = (typeof SCRIPT_RATES)[number];

export interface XrSettings {
	movementMode: MovementMode;
	rotationMode: RotationMode;
	/** The avatar worn on entering any world, as a copy of the inventory item chosen. Null uses the built-in one. */
	defaultAvatar: SlotTree | null;
	/** Where that copy came from (`adapterId:itemId`), so the inventory can show which avatar is worn. Null when none is chosen. */
	defaultAvatarSource: string | null;
	/** Sitting down: the head is lifted to standing height (1.7 m) so the avatar and the world behave as if you stood. */
	seatedMode: boolean;
	/** How far the personal menu bends around you: the angle (degrees) its width spans. 0 is flat. */
	dashCurve: number;
	/** How far in front of you (metres) the personal menu opens. */
	dashDistance: number;
	/** The in-world keyboard's layout last typed with (see keyboard/layouts). Null picks the page's language. */
	keyboardLayout: string | null;
	foveation: FoveationLevel;
	/** World scripts run once every this many frames (1 = every frame), for headsets that cannot keep up: a world reacts a little later, but runs. */
	scriptRate: ScriptRate;
	/** A small readout of frames per second, draw calls and meshes drawn, to see what a world costs. */
	showPerformance: boolean;
	/** Both eyes drawn by each draw call (WebXR layers + multiview), where the headset supports it. Takes effect on entering VR. */
	multiview: boolean;
	/** Frames per second asked of the headset's display (one it lists as supported). Null keeps the headset's own. */
	frameRate: number | null;
	/** Desktop (mouse and keyboard): how fast the view turns with the mouse, as a multiple of the default. */
	mouseSensitivity: number;
	/** Desktop: moving the mouse up looks down. */
	invertY: boolean;
	/** Desktop: the camera's vertical field of view, in degrees. */
	desktopFov: number;
	/** Master volume for music, effects and other world audio. */
	masterVolume: number;
	/** Where the objects a world saves for you (as its host) are kept. Local costs no cloud space; cloud follows you between devices. */
	worldStorageLocation: WorldItemLocation;
	/** Send the errors this device hits to the platform, so that they can be fixed (see src/lib/clientErrorReporter.ts). */
	shareErrorReports: boolean;
	/** Performance experiments switched on (see experiments.ts), by id. Dev builds see all of them; a release only the ones an experiment lists for production. */
	experiments: Record<string, boolean>;
}

export const MOUSE_SENSITIVITIES = [0.5, 1, 1.6, 2.5] as const;
/** The distances (metres) the personal menu can open at. */
export const DASH_DISTANCES = [0.6, 0.8, 1, 1.3, 1.7] as const;
export const DESKTOP_FOVS = [46, 60, 75] as const;

export const xrSettings: XrSettings = {
	movementMode: 'smooth',
	rotationMode: 'snap-45',
	defaultAvatar: null,
	defaultAvatarSource: null,
	seatedMode: false,
	dashCurve: 55,
	dashDistance: 1,
	keyboardLayout: null,
	foveation: 'high',
	scriptRate: 1,
	showPerformance: false,
	multiview: true,
	frameRate: null,
	mouseSensitivity: 1,
	invertY: false,
	desktopFov: 46,
	masterVolume: 1,
	worldStorageLocation: 'local',
	shareErrorReports: true,
	experiments: {}
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
		if (typeof parsed.dashCurve === 'number' && parsed.dashCurve >= 0 && parsed.dashCurve <= 120) xrSettings.dashCurve = parsed.dashCurve;
		if (typeof parsed.dashDistance === 'number' && parsed.dashDistance >= 0.3 && parsed.dashDistance <= 3) xrSettings.dashDistance = parsed.dashDistance;
		if (typeof parsed.keyboardLayout === 'string') xrSettings.keyboardLayout = parsed.keyboardLayout;
		if (parsed.foveation && parsed.foveation in FOVEATION) xrSettings.foveation = parsed.foveation;
		if (SCRIPT_RATES.includes(parsed.scriptRate as ScriptRate)) xrSettings.scriptRate = parsed.scriptRate as ScriptRate;
		if (typeof parsed.showPerformance === 'boolean') xrSettings.showPerformance = parsed.showPerformance;
		if (typeof parsed.multiview === 'boolean') xrSettings.multiview = parsed.multiview;
		if (typeof parsed.frameRate === 'number' && parsed.frameRate > 0) xrSettings.frameRate = parsed.frameRate;
		if (typeof parsed.mouseSensitivity === 'number' && parsed.mouseSensitivity > 0 && parsed.mouseSensitivity <= 5) xrSettings.mouseSensitivity = parsed.mouseSensitivity;
		if (typeof parsed.invertY === 'boolean') xrSettings.invertY = parsed.invertY;
		if (typeof parsed.desktopFov === 'number' && parsed.desktopFov >= 30 && parsed.desktopFov <= 110) xrSettings.desktopFov = parsed.desktopFov;
		if (typeof parsed.masterVolume === 'number' && parsed.masterVolume >= 0 && parsed.masterVolume <= 1) xrSettings.masterVolume = parsed.masterVolume;
		if (typeof parsed.shareErrorReports === 'boolean') xrSettings.shareErrorReports = parsed.shareErrorReports;
		if (parsed.experiments && typeof parsed.experiments === 'object') {
			for (const [id, on] of Object.entries(parsed.experiments)) if (typeof on === 'boolean') xrSettings.experiments[id] = on;
		}
		if (parsed.worldStorageLocation === 'local' || parsed.worldStorageLocation === 'cloud') xrSettings.worldStorageLocation = parsed.worldStorageLocation;
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
