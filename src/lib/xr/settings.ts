export type MovementMode = 'teleport' | 'smooth';
export type RotationMode = 'smooth' | 'snap-45' | 'snap-90';

export interface XrSettings {
	movementMode: MovementMode;
	rotationMode: RotationMode;
}

export const xrSettings: XrSettings = {
	movementMode: 'teleport',
	rotationMode: 'snap-45'
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
