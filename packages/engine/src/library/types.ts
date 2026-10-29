/**
 * The contract of an external content library: a service that can be searched for assets (models, PBR materials, sounds…) and
 * that serves their files. Nothing here is about one kind of asset or one service; `kind` and `FileRole` are open lists that only
 * grow, and what is done with a download belongs to an importer for that kind, not to the source.
 */
export type AssetKind = 'model' | 'material' | 'texture' | 'hdri' | 'audio' | 'image' | 'font' | 'pack';
export const ASSET_KINDS: readonly AssetKind[] = ['model', 'material', 'texture', 'hdri', 'audio', 'image', 'font', 'pack'];

/** `'unknown'` is for a source that does not say; it counts as not allowed wherever the answer matters. */
export interface License {
	name: string;
	url?: string;
	commercialUse: boolean | 'unknown';
	attributionRequired: boolean | 'unknown';
}

/** `source:nativeId`, for example `polyhaven:brick_wall_002`. The only id the rest of the app handles. */
export type AssetRef = `${string}:${string}`;

export type FileRole = 'model' | 'albedo' | 'normal' | 'roughness' | 'metallic' | 'ao' | 'arm' | 'height' | 'opacity' | 'emissive' | 'hdri' | 'audio' | 'image' | 'archive' | 'other';
export const FILE_ROLES: readonly FileRole[] = ['model', 'albedo', 'normal', 'roughness', 'metallic', 'ao', 'arm', 'height', 'opacity', 'emissive', 'hdri', 'audio', 'image', 'archive', 'other'];

export interface SourceInfo {
	/** Lowercase letters, digits and dashes: `polyhaven`, `shep`. */
	id: string;
	name: string;
	homepage: string;
	/** What it can serve. */
	kinds: AssetKind[];
	/** `link`: it can be searched, but the files have to be taken on its own site. */
	access: 'api' | 'link';
	/** The only hosts its files may come from (`*.example.com` matches any subdomain). */
	allowedHosts: string[];
	needsKey?: boolean;
	/** An aggregator lists the source ids it already includes, so a merged search does not show the same asset twice. */
	covers?: string[];
	defaultLicense?: License;
}

export interface SearchFilters {
	freeOnly?: boolean;
	commercialOnly?: boolean;
	category?: string;
	maxPolyCount?: number;
	/** Only what can be imported here. On unless set to `false`: an asset that has to be taken from its own site is left out. */
	importableOnly?: boolean;
}

export interface SearchQuery {
	text: string;
	kind: AssetKind;
	/** Opaque: a page number, an offset or a token, whatever the source pages by. Whatever came in `next` goes back here. */
	cursor?: string;
	limit?: number;
	filters?: SearchFilters;
}

export interface AssetFacts {
	polyCount?: number;
	animated?: boolean;
	rigged?: boolean;
	/** Metres one repeat of a material covers in the real world. */
	realWorldSize?: number;
	maps?: string[];
	resolutions?: string[];
}

export interface AssetSummary {
	ref: AssetRef;
	kind: AssetKind;
	title: string;
	thumbnailUrl?: string;
	author?: string;
	license: License;
	tags: string[];
	categories?: string[];
	/** The asset's own page: always shown, so people can see where it comes from. */
	sourceUrl: string;
	downloadable: boolean;
	facts?: AssetFacts;
}

export interface RemoteFile {
	/** What the file is for, so importers do not have to guess from its name. */
	role: FileRole;
	url: string;
	format: string;
	sizeBytes?: number;
	/** Companion files that must sit next to it (a `.gltf`'s `.bin` and pictures). */
	includes?: { path: string; url: string; sizeBytes?: number }[];
}

/** One way to take an asset: a resolution and a format. A material has one per resolution, a model one per format and size. */
export interface Variant {
	id: string;
	label: string;
	resolution?: string;
	format: string;
	totalBytes?: number;
	files: RemoteFile[];
	/** Why this variant can not be imported as it is (a format the engine can not load), shown instead of the Import button. */
	unsupported?: string;
}

export interface AssetDetail extends AssetSummary {
	description?: string;
	variants: Variant[];
}

export interface SearchPage {
	items: AssetSummary[];
	/** The cursor of the next page, or null when this was the last. */
	next: string | null;
	total?: number;
}

export interface AssetSource {
	readonly info: SourceInfo;
	search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage>;
	/** `nativeId` is the part of the ref after the source id. */
	detail(nativeId: string, signal?: AbortSignal): Promise<AssetDetail>;
	/**
	 * Optional: for the files of this source that are not a plain address to GET (a model assembled from several files, a map inside an
	 * archive, a signed link). It answers `null` for any file it does not handle, and then the library fetches `file.url` itself under
	 * the host allowlist and a size cap, so a source only has to deal with its special cases.
	 */
	open?(file: RemoteFile, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}
