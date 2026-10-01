import type { AppInfoComponent, Slot } from '../ecs/types';
import { PLATFORM_NAME } from '../platform.ts';

export const APP_ICON_SIZES = [192, 512] as const;
export type AppIconSize = (typeof APP_ICON_SIZES)[number];

/** The install dialog needs a screenshot without `form_factor: wide` for mobile, and one that is wide for desktop. */
export const SCREENSHOT_NARROW = { width: 720, height: 1280 } as const;
export const SCREENSHOT_WIDE = { width: 1280, height: 720 } as const;

const DEFAULT_COLOR = '#0b1030';
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface WorldAppDescriptor {
	name: string;
	shortName: string;
	description: string;
	themeColor: string;
	backgroundColor: string;
}

export interface WebAppManifest {
	id: string;
	name: string;
	short_name: string;
	description: string;
	start_url: string;
	scope: string;
	display: 'standalone';
	theme_color: string;
	background_color: string;
	icons: { src: string; sizes: string; type: string; purpose?: string }[];
	screenshots: { src: string; sizes: string; type: string; label: string; form_factor?: 'wide' }[];
}

/** The scene's `appInfo` component, if it has one. */
export function findAppInfo(scene: readonly Pick<Slot, 'components'>[]): AppInfoComponent | null {
	for (const slot of scene) {
		const found = slot.components?.find((component): component is AppInfoComponent => component.type === 'appInfo');
		if (found) return found;
	}
	return null;
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const color = (value: unknown): string => (typeof value === 'string' && HEX_COLOR.test(value) ? value : DEFAULT_COLOR);

/** What the installed app shows, with the published world's own name as the fallback for anything left empty. */
export function describeWorldApp(worldName: string, info: AppInfoComponent | null): WorldAppDescriptor {
	const name = text(info?.name, 45) || text(worldName, 45) || PLATFORM_NAME;
	return {
		name,
		shortName: text(info?.shortName, 12) || name.slice(0, 12),
		description: text(info?.description, 300),
		themeColor: color(info?.themeColor),
		backgroundColor: color(info?.backgroundColor ?? info?.themeColor)
	};
}

export const worldAppPath = (publicationId: string): string => `/play/${encodeURIComponent(publicationId)}`;

/** The web app manifest of a published world. Each world is its own app: its own id, scope and start URL. */
export function buildWorldManifest(publicationId: string, descriptor: WorldAppDescriptor, version: string): WebAppManifest {
	const base = worldAppPath(publicationId);
	const icon = (size: AppIconSize, purpose?: string) => ({
		src: `${base}/icon/${size}${purpose ? `-${purpose}` : ''}.png?v=${encodeURIComponent(version)}`,
		sizes: `${size}x${size}`,
		type: 'image/png',
		...(purpose ? { purpose } : {})
	});
	return {
		id: base,
		name: descriptor.name,
		short_name: descriptor.shortName,
		description: descriptor.description,
		start_url: base,
		scope: `${base}/`,
		display: 'standalone',
		theme_color: descriptor.themeColor,
		background_color: descriptor.backgroundColor,
		icons: [icon(192), icon(512), icon(512, 'maskable')],
		screenshots: [
			{ src: `${base}/icon/screenshot-narrow.png?v=${encodeURIComponent(version)}`, sizes: `${SCREENSHOT_NARROW.width}x${SCREENSHOT_NARROW.height}`, type: 'image/png', label: descriptor.name },
			{ src: `${base}/icon/screenshot-wide.png?v=${encodeURIComponent(version)}`, sizes: `${SCREENSHOT_WIDE.width}x${SCREENSHOT_WIDE.height}`, type: 'image/png', label: descriptor.name, form_factor: 'wide' }
		]
	};
}

/** Parses `screenshot-narrow.png` / `screenshot-wide.png`. */
export function parseScreenshotName(name: string): { width: number; height: number } | null {
	if (name === 'screenshot-narrow.png') return SCREENSHOT_NARROW;
	if (name === 'screenshot-wide.png') return SCREENSHOT_WIDE;
	return null;
}

/** Parses the `192.png` / `512-maskable.png` part of an icon URL. */
export function parseIconName(name: string): { size: AppIconSize; maskable: boolean } | null {
	const match = /^(\d+)(-maskable)?\.png$/.exec(name);
	if (!match) return null;
	const size = Number(match[1]);
	return (APP_ICON_SIZES as readonly number[]).includes(size) ? { size: size as AppIconSize, maskable: Boolean(match[2]) } : null;
}
