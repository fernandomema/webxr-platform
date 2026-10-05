import { Control, Rectangle, ScrollViewer, StackPanel, type TextBlock } from '@babylonjs/gui';
import { THEME } from './theme.ts';

/**
 * Building blocks for GUI pages that cannot overflow their panel.
 *
 * Two things about Babylon's GUI keep biting, and these helpers are written round them:
 *  - A control's padding and margin are taken out of the size it is given, not added to it. A 44 px text with
 *    `paddingTop = '40px'` has 4 px left to draw in, so it is clipped. For a gap, use `spacer`.
 *  - A scroll viewer clips what is wider than it, centred, so a card a little wider than the list loses its left and
 *    right edges. Size content from the column's `width`, never from a number of your own.
 */

/** The size of a tab's page in the dash. */
export const PAGE_WIDTH = 1024;
export const PAGE_HEIGHT = 520;

const SIDE_MARGIN = 24;
const BAR_SIZE = 8;
/** Room kept between the content and the scroll bar, so nothing runs under it. */
const BAR_GUTTER = 12;

export interface ScrollColumn {
	scroll: ScrollViewer;
	/** Add the page's controls here. */
	list: StackPanel;
	/** The width, in px, that is safe for a control in `list`: wider than this is clipped. */
	width: number;
}

/** A vertically scrolling column filling the page (below `top`), with a `width` its content is sure to fit in. */
export function createScrollColumn(name: string, options: { top?: number; height?: number } = {}): ScrollColumn {
	const { top = 0, height = PAGE_HEIGHT } = options;
	const scroll = new ScrollViewer(`${name}-scroll`);
	scroll.width = `${PAGE_WIDTH - 2 * SIDE_MARGIN}px`;
	scroll.height = `${height}px`;
	scroll.top = `${top}px`;
	scroll.thickness = 0;
	scroll.barSize = BAR_SIZE;
	scroll.barColor = THEME.accent;
	scroll.barBackground = THEME.ink;
	const width = PAGE_WIDTH - 2 * SIDE_MARGIN - BAR_SIZE - 2 * BAR_GUTTER;
	const list = new StackPanel(`${name}-list`);
	list.width = `${width}px`;
	scroll.addControl(list);
	return { scroll, list, width };
}

/** Empty space of `height` px between controls of a stack. */
export function spacer(name: string, height: number): Rectangle {
	const space = new Rectangle(name);
	space.height = `${height}px`;
	space.thickness = 0;
	space.isHitTestVisible = false;
	return space;
}

/** A card in a column: `height` includes the 10 px left under it, and `width` should be the column's. */
export function createCard(name: string, width: number, height: number): Rectangle {
	const card = new Rectangle(name);
	card.width = `${width}px`;
	card.height = `${height}px`;
	card.paddingBottom = '10px';
	card.thickness = 1;
	card.color = THEME.border;
	card.background = THEME.surface;
	card.cornerRadius = 12;
	return card;
}

/** A line of text inside a card (or any container), placed from its top-left corner. */
export function placeText(parent: Rectangle, block: TextBlock, left: number, top: number, width: number, height: number): void {
	block.width = `${width}px`;
	block.height = `${height}px`;
	block.left = `${left}px`;
	block.top = `${top}px`;
	block.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	block.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	block.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	block.isHitTestVisible = false;
	parent.addControl(block);
}
