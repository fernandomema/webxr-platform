/**
 * A keyboard layout is data: pages of rows of keys. Adding a language is adding a layout (and, for a script that is
 * composed rather than typed letter by letter, an input composer — see composer.ts); nothing else changes.
 * Pure: no Babylon, tested in Node.
 */

/** `left` / `right` move the text cursor one character. */
export type KeyAction = 'backspace' | 'enter' | 'shift' | 'space' | 'page' | 'layout' | 'close' | 'left' | 'right';

export interface KeyDef {
	/** What the key types. Absent on a key that does something instead (`action`). */
	text?: string;
	/** What it types with shift on. Defaults to `text` in upper case. */
	shifted?: string;
	/** What the key shows, when that is not what it types (⌫, ↵, "123"…). */
	label?: string;
	action?: KeyAction;
	/** Width in key units: a letter key is 1. */
	width?: number;
	/** Characters offered by holding the key down, as on a phone (é è ê ë on the e). Upper-cased with shift on. */
	variants?: string[];
	/** For a `page` key: the page it switches to. */
	page?: string;
}

export interface KeyboardLayout {
	/** Stable id, e.g. 'es'. */
	id: string;
	/** The name shown on the layout key, in the layout's own language. */
	name: string;
	/** Short tag for the layout key, e.g. 'ES'. */
	short: string;
	/** Which input composer turns keys into text ('direct' types each key as it is). */
	composer?: string;
	/** The page shown first. */
	firstPage: string;
	pages: Record<string, KeyDef[][]>;
}

/** Everything wrong with a layout, as readable messages; empty when it is usable. */
export function layoutProblems(layout: KeyboardLayout): string[] {
	const problems: string[] = [];
	if (!layout.id || !layout.name || !layout.short) problems.push('a layout needs an id, a name and a short tag');
	if (!layout.pages[layout.firstPage]) problems.push(`the first page "${layout.firstPage}" does not exist`);
	for (const [pageName, rows] of Object.entries(layout.pages)) {
		if (!rows.length) problems.push(`page "${pageName}" has no rows`);
		rows.forEach((row, r) => {
			if (!row.length) problems.push(`page "${pageName}" row ${r + 1} is empty`);
			row.forEach((key, k) => {
				const where = `page "${pageName}" row ${r + 1} key ${k + 1}`;
				if (!key.text && !key.action) problems.push(`${where} neither types nor does anything`);
				if (key.width !== undefined && !(key.width > 0)) problems.push(`${where} has no width`);
				if (key.action === 'page' && !(key.page && layout.pages[key.page])) problems.push(`${where} goes to a page that does not exist`);
			});
		});
	}
	return problems;
}

/** A key placed on the keyboard: its centre and size in key units, rows running away from the typist (row 0 nearest the top). */
export interface PlacedKey {
	key: KeyDef;
	row: number;
	column: number;
	x: number;
	y: number;
	width: number;
}

/** Lays a page's rows out, each row centred: returns the keys and the size of the whole block, in key units. */
export function placeKeys(rows: KeyDef[][]): { keys: PlacedKey[]; width: number; height: number } {
	const widths = rows.map((row) => row.reduce((sum, key) => sum + (key.width ?? 1), 0));
	const width = Math.max(0, ...widths);
	const keys: PlacedKey[] = [];
	rows.forEach((row, r) => {
		let x = -widths[r] / 2;
		row.forEach((key, column) => {
			const w = key.width ?? 1;
			keys.push({ key, row: r, column, x: x + w / 2, y: r, width: w });
			x += w;
		});
	});
	return { keys, width, height: rows.length };
}

/** What a key shows, given whether shift is on. */
export function keyLabel(key: KeyDef, shifted: boolean): string {
	if (key.label) return key.label;
	if (key.text === undefined) return '';
	return shifted ? (key.shifted ?? key.text.toLocaleUpperCase()) : key.text;
}

/** What a key types, given whether shift is on (a variant chosen by holding it down takes its place). */
export function keyText(key: KeyDef, shifted: boolean, variant?: string): string {
	const base = variant ?? key.text ?? '';
	if (!shifted) return base;
	if (variant === undefined && key.shifted !== undefined) return key.shifted;
	return base.toLocaleUpperCase();
}

/** The variants a key offers, in the case shift asks for. */
export function keyVariants(key: KeyDef, shifted: boolean): string[] {
	return (key.variants ?? []).map((variant) => (shifted ? variant.toLocaleUpperCase() : variant));
}
