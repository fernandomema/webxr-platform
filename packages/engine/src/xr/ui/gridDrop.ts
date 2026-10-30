import type { Vector3 } from '@babylonjs/core';
import type { SlotTree } from '../../ecs/types.ts';

/** A grid that takes pieces of UI let go over it (see dashPinSystem.ts). Every grid being shown registers one. */
export interface GridDropTarget {
	/** Whether it is open for editing and on screen: the only time it takes a piece of UI. */
	isOpen(): boolean;
	/** Where a point of the world is over the grid (px from its top-left corner), or null when it is not over it. */
	pointAt(world: Vector3): { x: number; y: number } | null;
	/** Shows where a piece of UI with this panel size would land at `point`, or stops showing it (null). */
	previewDrop(panel: { width: number; height: number } | null, point: { x: number; y: number } | null): void;
	/** Keeps a copy of a world's UI (`slotId` and what is under it) on the grid. */
	pinUi(world: SlotTree, slotId: string, point?: { x: number; y: number }): 'pinned' | 'full' | 'not-ui';
}

const targets = new Set<GridDropTarget>();

/** Makes a grid take pieces of UI. Returns a function that stops it. */
export function registerGridDropTarget(target: GridDropTarget): () => void {
	targets.add(target);
	return () => targets.delete(target);
}

export const gridDropTargets = (): readonly GridDropTarget[] => [...targets];
