import type { SlotTree } from '$lib/ecs/types';
import type { InventoryAdapterId } from '$lib/inventory/types';
import type { WorldVisibility } from '$lib/worldVisibility';

/** Provenance is informational. A portable portal always carries its own immutable scene. */
export type WorldSource =
	| { kind: 'inventory'; adapterId: InventoryAdapterId; itemId: string; ownerId?: string | null; worldLineageId?: string | null; revisionNumber?: number | null }
	| { kind: 'published'; worldId: string; revisionId?: string };

export interface WorldPackage {
	formatVersion: 1;
	name: string;
	scene: SlotTree;
	defaultVisibility: WorldVisibility;
	source?: WorldSource;
}
