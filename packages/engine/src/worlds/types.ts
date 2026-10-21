import type { SlotTree } from '../ecs/types.ts';
import type { InventoryStorageAdapterId } from '../inventory/types.ts';
import type { WorldVisibility } from '../worldVisibility.ts';
import type { AssetSummary } from '../assets/manifest.ts';
import type { AssetId } from '../assets/ref.ts';

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
	/** The world's 360° preview image (an `image` asset). Its orb shows it on the inside of a glass globe. Cosmetic: a world loads without it. */
	preview?: AssetId | null;
}
