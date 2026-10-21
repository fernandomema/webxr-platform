/**
 * The colours of the in-game menus and panels (the dash, the worlds browser, keyboards, popups), taken from the
 * landing page's palette (`--color-*` in routes/layout.css): near-black ink surfaces, warm bone text, and ember
 * and glow as the accents. Keep these two in step so the app looks like one product.
 */
const palette = {
	/** Page and deepest wells. */
	ink: '#07070c',
	/** Panel backgrounds. */
	panel: '#0d0d16',
	/** Cards and fields sitting on a panel. */
	surface: '#13131f',
	surfaceHover: '#1d1d2d',
	/** Neutral buttons and keys. */
	raised: '#26263a',
	border: '#2b2b3d',
	text: '#f4f1ea',
	muted: '#9b9aa3',
	dim: '#6b6a78',
	/** Primary actions and the selected state: a deeper ember that keeps bone text readable. */
	accent: '#d9531f',
	accentSoft: '#3a1d12',
	/** Outlines and highlights of the selected state. */
	accentBorder: '#ff7a45',
	ember: '#ff7a45',
	glow: '#ffcf7a',
	mint: '#8ff0cf',
	iris: '#9b8cff',
	sky: '#6ec3ff',
	/** Positive actions (a deeper mint, for buttons with bone text). */
	go: '#1f8f78',
	danger: '#b4332b',
	ok: '#8ff0cf',
	warn: '#ffcf7a',
	error: '#ff7b6b'
};

export const THEME: Readonly<Record<keyof typeof palette, string>> = palette;
