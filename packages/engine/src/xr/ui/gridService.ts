import type { Rectangle } from '@babylonjs/gui';

/** A grid shown by the service: take it down when its control goes. */
export interface GridMount {
	dispose(): void;
}

/**
 * What lets a UI panel hold a grid (a `uiElement` of kind `grid`): the personal menu provides it once it is built (it runs the
 * pieces of UI the grids hold). Until then, or where there is no menu, a grid element is an empty box.
 */
export interface GridService {
	mount(options: { container: Rectangle; size: { width: number; height: number }; gridId: string; title?: string }): GridMount;
}

let service: GridService | null = null;

export function setGridService(next: GridService | null): void {
	service = next;
}

export const getGridService = (): GridService | null => service;
