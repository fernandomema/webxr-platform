/**
 * Finds the cells of a tiled picture (the squares of a checker, the slabs of a floor) by looking for the lines where the picture
 * changes sharply, so a material that wraps a box can put the box's edges through the middle of the cells without being told how
 * the picture is laid out. Pure arrays in and out, so it is tested in Node; the caller reads the pixels.
 */
export interface CellLayout {
	/** Cells along one side of the picture. */
	cells: number;
	/** Where, in repeats, the first border between cells is (0 to 1 / cells). */
	phase: number;
}

const MAX_CELLS = 8;
/** A border counts when it changes the picture at least this much of what the sharpest one does. */
const BORDER_SHARE = 0.5;
/** The sharpest border must stand out from the picture's grain by this much, or there are no cells to speak of. */
const STANDS_OUT = 2;

/** How sharply the picture changes across each column of pixels (it wraps, since the picture repeats). */
function changes(gray: ArrayLike<number>, width: number, height: number, across: 'columns' | 'rows'): Float64Array {
	const length = across === 'columns' ? width : height;
	const out = new Float64Array(length);
	for (let i = 0; i < length; i++) {
		const next = (i + 1) % length;
		let sum = 0;
		const lines = across === 'columns' ? height : width;
		for (let line = 0; line < lines; line++) {
			const a = across === 'columns' ? gray[line * width + i] : gray[i * width + line];
			const b = across === 'columns' ? gray[line * width + next] : gray[next * width + line];
			sum += Math.abs(a - b);
		}
		out[i] = sum / lines;
	}
	// A border can fall between two pixels: let each change share with its neighbours.
	return out.map((_, i) => (out[(i + length - 1) % length] + 2 * out[i] + out[(i + 1) % length]) / 4);
}

function layoutOf(profile: Float64Array): CellLayout | null {
	const length = profile.length;
	const peak = Math.max(...profile);
	const mean = profile.reduce((sum, value) => sum + value, 0) / length;
	if (!(peak > 0) || peak < STANDS_OUT * mean) return null;
	let best: CellLayout | null = null;
	for (let cells = 1; cells <= MAX_CELLS; cells++) {
		const step = length / cells;
		let found: { phase: number; weakest: number; total: number } | null = null;
		for (let start = 0; start < step; start++) {
			let weakest = Infinity;
			let total = 0;
			for (let border = 0; border < cells; border++) {
				const value = profile[Math.round(start + border * step) % length];
				weakest = Math.min(weakest, value);
				total += value;
			}
			if (!found || total > found.total) found = { phase: ((start + 1) / length) % (1 / cells), weakest, total };
		}
		// Every border must be there: a grid of 4 laid over a picture of 2 has borders where nothing changes.
		if (found && found.weakest >= BORDER_SHARE * peak) best = { cells, phase: found.phase };
	}
	return best;
}

/**
 * The layout of the cells in a picture given as grey values (row by row, `width` by `height`), or null when it has none that can
 * be told apart from its grain. Read across the columns, so it is the layout along the picture's width.
 */
export function detectCells(gray: ArrayLike<number>, width: number, height: number): CellLayout | null {
	if (width < 4 || height < 4 || gray.length < width * height) return null;
	return layoutOf(changes(gray, width, height, 'columns'));
}

/**
 * The layout of the cells along both sides of a picture, as texture coordinates: `u` across, `v` up. A picture's cells need not
 * start at the same place both ways (a floor's slabs can begin a few pixels down from the top), so each is found on its own.
 * The picture is given from its top row, and textures are shown with their top row at v = 1, so the rows are counted from the
 * bottom.
 */
export function detectGrid(gray: ArrayLike<number>, width: number, height: number): { u: CellLayout | null; v: CellLayout | null } {
	if (width < 4 || height < 4 || gray.length < width * height) return { u: null, v: null };
	const fromTop = layoutOf(changes(gray, width, height, 'rows'));
	const v = fromTop && { cells: fromTop.cells, phase: (((1 - fromTop.phase) % (1 / fromTop.cells)) + 1 / fromTop.cells) % (1 / fromTop.cells) };
	return { u: layoutOf(changes(gray, width, height, 'columns')), v };
}

/** Grey values of an RGBA image. */
export function grayOf(rgba: ArrayLike<number>, pixels: number): Float64Array {
	const out = new Float64Array(pixels);
	for (let i = 0; i < pixels; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
	return out;
}

/** Where the picture should start at a corner of a box so its edges cross the middle of the cells: half a cell past a border. */
export function cornerOffset(layout: CellLayout | null): number {
	return layout ? (layout.phase + 0.5 / layout.cells) % 1 : 0;
}
