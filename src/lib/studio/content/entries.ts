import type { AssetManifest } from '@kithin/engine/assets/manifest';
import type { AssetId } from '@kithin/engine/assets/ref';

export interface UsedIn {
	/** `Name (where it is kept)`. */
	label: string;
	href?: string;
}

/** One stored file as the content manager shows it, whichever storage it lives in. */
export interface ContentEntry {
	assetId: AssetId;
	manifest: AssetManifest;
	/** Epoch ms. Null when the storage does not say. */
	addedAt: number | null;
	lastUsedAt: number | null;
	/** What still uses it. Null when the storage cannot tell, so nothing is ever called "unused" on a guess. */
	/** A copy fetched for something else rather than put here by the user: safe to clear, it comes back when needed. */
	cached: boolean;
	/** Kept by the app itself (the base avatar): never offered for cleanup. */
	builtin: boolean;
	/** The objects and worlds behind `usedBy`, when the storage can say; `href` opens the one in the editor. */
	usedIn?: UsedIn[];
	usedBy: { items: number; worlds: number; publications: number } | null;
}

export interface ContentUsage {
	bytes: number;
	count: number;
	/** 0 means no limit. */
	quota: number;
	/** Where the bytes go, when the storage can say. */
	parts?: Array<{ label: string; bytes: number }>;
}

const ASSET_ID = /sha256:[0-9a-f]{64}/g;

/** Every asset id mentioned anywhere in a JSON-like value, so what a scene or a preview uses never needs a per-component walk. */
export function assetIdsIn(value: unknown, into = new Set<AssetId>()): Set<AssetId> {
	for (const match of JSON.stringify(value ?? null).matchAll(ASSET_ID)) into.add(match[0] as AssetId);
	return into;
}

export const totalBytes = (entries: readonly ContentEntry[]): number => entries.reduce((sum, entry) => sum + entry.manifest.byteSize, 0);

/** A file the storage would refuse to remove because something still uses it. */
export function isRemovable(source: { adapterId: string }, entry: ContentEntry): boolean {
	return source.adapterId !== 'cloud' || !entry.usedBy || entry.usedBy.items + entry.usedBy.worlds + entry.usedBy.publications === 0;
}

export const isUnused = (entry: ContentEntry): boolean => !entry.builtin && entry.usedBy !== null && entry.usedBy.items + entry.usedBy.worlds + entry.usedBy.publications === 0;

