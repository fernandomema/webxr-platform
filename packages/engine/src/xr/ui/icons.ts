import { ICON_BODIES, ICON_SIZE } from './icons.generated.ts';

/**
 * Icons for the GUI panels, as images. They come from Iconify (the Lucide set, bundled by `npm run icons`), drawn as
 * SVG in the colour asked for and handed to a GUI `Image` as a data URI, so no request is made to show one.
 */
const extra = new Map<string, string>();
const cache = new Map<string, string>();

export function hasIcon(name: string): boolean {
	return name in ICON_BODIES || extra.has(name);
}

/** Makes `name` usable as an icon: `body` is the inside of a 24×24 SVG that draws with `currentColor` (the Iconify icon body format). */
export function registerIcon(name: string, body: string): void {
	extra.set(name, body);
	for (const key of [...cache.keys()]) if (key.startsWith(`${name}|`)) cache.delete(key);
}

/** The icon as a data URI of an SVG `size` px square, stroked or filled with `color`. Undefined for a name that is not known. */
export function iconUri(name: string, color: string, size = 64): string | undefined {
	const body = extra.get(name) ?? ICON_BODIES[name];
	if (!body) return undefined;
	const key = `${name}|${color}|${size}`;
	let uri = cache.get(key);
	if (!uri) {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">${body.replaceAll('currentColor', color)}</svg>`;
		uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		cache.set(key, uri);
	}
	return uri;
}
