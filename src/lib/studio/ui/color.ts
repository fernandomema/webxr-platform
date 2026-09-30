/** Colour maths for the custom colour picker (pure, so it can be tested in Node). */

export interface Hsv {
	h: number; // 0–360
	s: number; // 0–1
	v: number; // 0–1
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeHex(text: string): string | null {
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
	if (!match) return null;
	const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
	return `#${digits.toLowerCase()}`;
}

export function hexToHsv(hex: string): Hsv {
	const normal = normalizeHex(hex) ?? '#ffffff';
	const r = parseInt(normal.slice(1, 3), 16) / 255;
	const g = parseInt(normal.slice(3, 5), 16) / 255;
	const b = parseInt(normal.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const delta = max - Math.min(r, g, b);
	let h = 0;
	if (delta > 0) {
		if (max === r) h = ((g - b) / delta) % 6;
		else if (max === g) h = (b - r) / delta + 2;
		else h = (r - g) / delta + 4;
		h = (h * 60 + 360) % 360;
	}
	return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
	const hue = ((h % 360) + 360) % 360;
	const c = v * clamp(s, 0, 1);
	const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = v - c;
	const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
	const part = (value: number) => Math.round(clamp(value + m, 0, 1) * 255).toString(16).padStart(2, '0');
	return `#${part(r)}${part(g)}${part(b)}`;
}
