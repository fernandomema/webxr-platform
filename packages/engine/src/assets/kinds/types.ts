import type { AssetManifestBase, AssetSummary } from '../manifest.ts';

/** Why an import was refused. Every asset type throws this (or a subclass) so callers can show one message path. */
export class AssetImportError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
		this.name = 'AssetImportError';
	}
}

export interface AssetFormat {
	/** Stored in the manifest and the database, e.g. `glb`, `mp3`. */
	format: string;
	/** Lower-case file extensions with the dot. The first one is used for storage keys. */
	extensions: readonly string[];
	mimeType: string;
}

/** What `analyze` returns: everything in the manifest that the file itself decides. */
export type AssetAnalysis<M extends AssetManifestBase> = Omit<M, 'assetId' | 'byteSize' | 'name' | 'mimeType' | 'type'>;

/**
 * Everything the platform needs to know about one kind of asset. The pipeline
 * (import, local store, cloud upload, sharing, cleanup) is generic and only asks
 * a kind these questions, so supporting a new kind is one file that registers
 * itself in `kinds/index.ts`.
 */
export interface AssetKindDef<M extends AssetManifestBase = AssetManifestBase> {
	type: M['type'];
	/** Plural, for section headings ("Models", "Audio"). */
	label: string;
	/** Name given to a file whose own name is unusable. */
	defaultName: string;
	formats: readonly AssetFormat[];
	maxBytes: number;
	/** How many leading bytes `sniff` needs. The server reads only this much of an upload. */
	headBytes: number;
	/** Recognises the format from the first bytes alone (no extension trusted), or returns null. */
	sniff(head: Uint8Array): string | null;
	/** Client side: validates the whole file against the kind's budgets and measures it. Throws `AssetImportError`. */
	analyze(bytes: Uint8Array, fileName: string, limits?: unknown): Promise<AssetAnalysis<M>> | AssetAnalysis<M>;
	/** Server side: checks the kind-specific fields of a manifest sent by a client. Throws `Error`. */
	validate(manifest: Partial<M>): void;
	/** Kind-specific part of the summary shipped with worlds and snapshots. */
	summary?(manifest: M): Partial<AssetSummary>;
}
