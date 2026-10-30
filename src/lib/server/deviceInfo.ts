export interface DeviceInfo {
	/** quest | pico | vision-pro | android | ios | windows | mac | linux | chromeos | other */
	platform: string;
	/** A headset or phone model when it can be told ("Quest 3"); otherwise a short label such as "Desktop". */
	device: string;
	/** Whether this is a standalone headset browser. */
	headset: boolean;
}

/**
 * What can be told about a device from its user agent and, when the browser gives it, the model from client hints
 * (`navigator.userAgentData`). Best effort: browsers hide and freeze these on purpose, so "other" and a missing model are normal.
 */
export function detectDevice(userAgent: string | null | undefined, hintedModel?: string | null): DeviceInfo {
	const ua = userAgent ?? '';
	const model = (hintedModel ?? '').trim().slice(0, 40);

	if (/OculusBrowser|Quest|Meta Quest/i.test(ua)) {
		// "(Linux; Android 12; Quest 3)" on current browsers; older ones say only "Quest" (the first) or nothing.
		const named = /\bQuest ?(Pro|3S|3|2|1)?\b/i.exec(`${ua} ${model}`);
		const suffix = named?.[1];
		return { platform: 'quest', headset: true, device: suffix ? `Quest ${suffix.toUpperCase() === 'PRO' ? 'Pro' : suffix.toUpperCase()}` : 'Quest (model unknown)' };
	}
	if (/PicoBrowser|Pico ?\d|PICO/i.test(ua)) {
		const named = /Pico ?(Neo ?\d|\d)/i.exec(`${ua} ${model}`);
		return { platform: 'pico', headset: true, device: named ? `Pico ${named[1]}` : 'Pico (model unknown)' };
	}
	if (/visionOS|Apple ?Vision/i.test(ua)) return { platform: 'vision-pro', headset: true, device: 'Apple Vision Pro' };
	if (/Android/i.test(ua)) {
		// Android phones put the model in the user agent ("Android 14; Pixel 8") or in the hint.
		const fromUa = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.trim();
		const device = model || (fromUa && fromUa !== 'K' ? fromUa : 'Android device');
		return { platform: 'android', headset: false, device: device.slice(0, 40) };
	}
	if (/iPhone|iPad|iPod/i.test(ua)) return { platform: 'ios', headset: false, device: /iPad/i.test(ua) ? 'iPad' : 'iPhone' };
	if (/CrOS/i.test(ua)) return { platform: 'chromeos', headset: false, device: 'Chromebook' };
	if (/Windows/i.test(ua)) return { platform: 'windows', headset: false, device: 'Desktop' };
	if (/Macintosh|Mac OS X/i.test(ua)) return { platform: 'mac', headset: false, device: 'Desktop' };
	if (/Linux|X11/i.test(ua)) return { platform: 'linux', headset: false, device: 'Desktop' };
	return { platform: 'other', headset: false, device: 'Unknown' };
}
