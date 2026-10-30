import { defaultGrid, normalizeGrid, HOME_SHAPE, type Grid, type GridShape } from './dashGrid.ts';

/** Where the Home grid has always been kept: the others have a key of their own. */
const HOME_KEY = 'webxr-platform-dash-grid';
const keyFor = (gridId: string) => (gridId === 'home' ? HOME_KEY : `webxr-platform-grid:${gridId}`);

/** What a player's grid is, kept on this device whatever world they are in and across sessions. */
export interface DashGridStore {
	get(): Grid;
	/** Replaces the grid and keeps it. Returns false when it could not be kept (storage full or unavailable); the grid still holds for this session. */
	set(grid: Grid): boolean;
	/** Calls `listener` whenever the grid changes. Returns a function that stops it. */
	onChange(listener: (grid: Grid) => void): () => void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * `storage` is where the grid is kept (the browser's by default; tests pass their own). The Home grid starts with the game's
 * shortcuts, any other starts empty.
 */
export function createDashGridStore(
	storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage,
	gridId = 'home',
	shape: GridShape = HOME_SHAPE
): DashGridStore {
	const fallback = gridId === 'home' ? defaultGrid : () => [];
	let grid: Grid;
	try {
		const raw = storage?.getItem(keyFor(gridId));
		grid = raw ? normalizeGrid(JSON.parse(raw), shape, fallback) : fallback();
	} catch {
		grid = fallback();
	}
	const listeners = new Set<(grid: Grid) => void>();
	return {
		get: () => grid,
		set(next) {
			grid = next;
			let kept = true;
			try {
				storage?.setItem(keyFor(gridId), JSON.stringify(next));
			} catch {
				kept = false;
			}
			for (const listener of listeners) listener(grid);
			return kept;
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

const shared = new Map<string, DashGridStore>();

/** The store of a grid by its id, the same one for every place that shows it (so they stay in step). */
export function gridStoreFor(gridId: string, shape: GridShape = HOME_SHAPE): DashGridStore {
	let store = shared.get(gridId);
	if (!store) {
		store = createDashGridStore(undefined, gridId, shape);
		shared.set(gridId, store);
	}
	return store;
}
