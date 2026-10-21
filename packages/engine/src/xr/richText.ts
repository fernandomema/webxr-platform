/**
 * Text with pictures in it. A `[[name]]` in a UI text is a picture (a key, a button of the controller) that goes where it is written,
 * the size of a letter, in the middle of the words; the words wrap around it. This file only works out where each word and picture
 * goes (`layoutRichText`), so it can be tested without drawing anything; uiPanelSurface.ts draws the result.
 */
export type RichItem =
	| { kind: 'word'; text: string; spaceBefore: boolean }
	| { kind: 'icon'; name: string; spaceBefore: boolean }
	| { kind: 'break' };

const ICON = /\[\[([a-z0-9_]+)\]\]/g;

export const hasIcons = (text: string | undefined): boolean => !!text && /\[\[[a-z0-9_]+\]\]/.test(text);

/** The words and pictures of a text, and whether a space came before each (a picture written right next to a letter stays next to it). */
export function parseRichText(text: string): RichItem[] {
	const items: RichItem[] = [];
	/** Whether blank space was seen since the last word or picture. */
	let space = false;
	const hasPrevious = () => items.length > 0 && items[items.length - 1].kind !== 'break';
	const addWords = (segment: string) => {
		segment.split('\n').forEach((line, lineIndex) => {
			if (lineIndex > 0) {
				items.push({ kind: 'break' });
				space = false;
			}
			for (const piece of line.split(/(\s+)/)) {
				if (piece === '') continue;
				if (/^\s+$/.test(piece)) {
					space = true;
					continue;
				}
				items.push({ kind: 'word', text: piece, spaceBefore: space && hasPrevious() });
				space = false;
			}
		});
	};
	let last = 0;
	for (const match of text.matchAll(ICON)) {
		addWords(text.slice(last, match.index));
		items.push({ kind: 'icon', name: match[1], spaceBefore: space && hasPrevious() });
		space = false;
		last = match.index + match[0].length;
	}
	addWords(text.slice(last));
	return items;
}

export interface RichPlacement {
	item: Exclude<RichItem, { kind: 'break' }>;
	x: number;
	width: number;
	/** The space that comes before it, already counted in `x` and `width`. */
	gap: number;
}

export interface RichLine {
	placements: RichPlacement[];
	width: number;
	height: number;
}

export interface RichLayoutOptions {
	/** The width the text may take. */
	width: number;
	fontSize: number;
	align: 'left' | 'center' | 'right';
	/** How wide a word is, in the font it is drawn in. */
	measure(text: string): number;
	/** A picture is this high and wide; a letter's height by default. */
	iconSize?: number;
	lineHeight?: number;
}

export interface RichLayout {
	lines: RichLine[];
	height: number;
	iconSize: number;
}

export function layoutRichText(items: readonly RichItem[], options: RichLayoutOptions): RichLayout {
	const iconSize = options.iconSize ?? Math.round(options.fontSize * 1.3);
	const lineHeight = options.lineHeight ?? Math.round(options.fontSize * 1.25);
	const space = options.measure(' ') || options.fontSize * 0.3;
	const sizeOf = (item: Exclude<RichItem, { kind: 'break' }>) => (item.kind === 'icon' ? iconSize : options.measure(item.text));
	const lines: RichLine[] = [];
	let line: RichPlacement[] = [];
	let x = 0;
	const finish = () => {
		const hasIcon = line.some((placement) => placement.item.kind === 'icon');
		const shift = options.align === 'center' ? Math.max(0, (options.width - x) / 2) : options.align === 'right' ? Math.max(0, options.width - x) : 0;
		lines.push({ placements: line.map((placement) => ({ ...placement, x: placement.x + shift })), width: x, height: hasIcon ? Math.max(lineHeight, iconSize) : lineHeight });
		line = [];
		x = 0;
	};
	// A word or picture written against the one before it (a full stop after a picture) is one unit with it: it never starts a line alone.
	const units: Array<Array<Exclude<RichItem, { kind: 'break' }> | { kind: 'break' }>> = [];
	for (const item of items) {
		if (item.kind !== 'break' && !item.spaceBefore && units.length > 0 && units[units.length - 1][0].kind !== 'break') units[units.length - 1].push(item);
		else units.push([item]);
	}
	for (const unit of units) {
		const first = unit[0];
		if (first.kind === 'break') {
			finish();
			continue;
		}
		const sizes = unit.map((item) => sizeOf(item as Exclude<RichItem, { kind: 'break' }>));
		const total = sizes.reduce((sum, size) => sum + size, 0);
		let gap = first.spaceBefore && line.length ? space : 0;
		if (line.length && x + gap + total > options.width) {
			finish();
			gap = 0;
		}
		unit.forEach((item, index) => {
			const itemGap = index === 0 ? gap : 0;
			line.push({ item: item as Exclude<RichItem, { kind: 'break' }>, x: x + itemGap, width: sizes[index] + itemGap, gap: itemGap });
			x += itemGap + sizes[index];
		});
	}
	if (line.length || lines.length === 0) finish();
	return { lines, height: lines.reduce((sum, current) => sum + current.height, 0), iconSize };
}
