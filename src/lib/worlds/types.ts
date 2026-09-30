import type { SlotTree } from '$lib/ecs/types';
import type { InventoryStorageAdapterId } from '$lib/inventory/types';
import type { WorldVisibility } from '$lib/worldVisibility';
import type { AssetSummary } from '$lib/assets/manifest';

/** Provenance is informational. A portable portal always carries its own immutable scene. */
export type WorldSource =
	| { kind: 'inventory'; adapterId: InventoryStorageAdapterId; itemId: string; ownerId?: string | null; worldLineageId?: string | null; folderId?: string | null; revisionNumber?: number | null }
	| { kind: 'published'; worldId: string; revisionId?: string };

export interface WorldPackage {
	formatVersion: 1;
	name: string;
	scene: SlotTree;
	defaultVisibility: WorldVisibility;
	source?: WorldSource;
	/** Sizes and bounds of the models this scene uses (including inside nested portals), so placeholders can be sized before any download. */
	assets?: AssetSummary[];
}
