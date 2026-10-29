import { ASSET_LIMITS } from '@kithin/engine/assets/limits';
import { allowsCommercialUse } from '@kithin/engine/library/license';
import { dropCovered, interleave } from '@kithin/engine/library/merge';
import { formatAssetRef, parseAssetRef } from '@kithin/engine/library/ref';
import { ASSET_KINDS, type AssetDetail, type AssetKind, type AssetSource, type AssetSummary, type SearchFilters } from '@kithin/engine/library/types';
import { checkDetail, checkSummary } from '@kithin/engine/library/validate';
import { cachedLoader, fetchLimited, LibraryError, TtlCache } from './http';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const MAP_BYTES = 8 * 1024 * 1024;

/** The ref and kind of a result are the source's own; a source that fails on one request must not take the others down. */
function asLibraryError(error: unknown): LibraryError {
	if (error instanceof LibraryError) return error;
	const status = (error as { status?: unknown } | null)?.status;
	if (typeof status === 'number' && status >= 400 && status < 500) return new LibraryError(status, error instanceof Error ? error.message : 'The request was refused.');
	return new LibraryError(502, 'The source could not answer right now.');
}

export interface SearchRequest {
	/** A source id, or `all` for every source that serves the kind. */
	source: string;
	kind: string;
	text: string;
	cursor?: string;
	limit?: number;
	filters?: SearchFilters;
}

export interface SearchResponse {
	items: AssetSummary[];
	next: string | null;
	total?: number;
	/** In a merged search, the sources that failed (the others still answered). */
	errors?: { source: string; message: string }[];
}

const encodeCursor = (cursors: Record<string, string>): string => Buffer.from(JSON.stringify(cursors)).toString('base64url');
function decodeCursor(value: string): Record<string, string> | null {
	try {
		const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length < 500));
	} catch { return null; }
}

const fileName = (title: string, role: string, format: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'asset'}-${role}.${format.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`;

/** The library over a set of sources: what the routes call. It trusts nothing a source returns until it has checked it against the contract. */
export function createLibrary(sources: readonly AssetSource[]) {
	const byId = new Map(sources.map((source) => [source.info.id, source]));
	const loadDetail = cachedLoader(new TtlCache<AssetDetail>(5 * 60_000));
	const sourceOf = (id: string): AssetSource => {
		const source = byId.get(id);
		if (!source) throw new LibraryError(404, 'Unknown source.');
		return source;
	};

	async function detail(ref: string, signal?: AbortSignal): Promise<AssetDetail> {
		const parsed = parseAssetRef(ref);
		if (!parsed) throw new LibraryError(400, 'Invalid asset reference.');
		const source = sourceOf(parsed.source);
		try {
			const found = await loadDetail(ref, () => source.detail(parsed.nativeId, signal));
			const problems = checkDetail(found);
			if (problems.length) {
				console.error(`[library] ${source.info.id} returned an unusable detail`, problems.slice(0, 5));
				throw new LibraryError(502, 'The source returned an unusable answer.');
			}
			return { ...found, ref: formatAssetRef(parsed.source, parsed.nativeId) };
		} catch (error) { throw asLibraryError(error); }
	}

	return {
		sources: () => sources.map(({ info }) => ({ id: info.id, name: info.name, homepage: info.homepage, kinds: info.kinds, access: info.access })),

		async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
			if (!ASSET_KINDS.includes(request.kind as AssetKind)) throw new LibraryError(400, 'Unknown kind.');
			const kind = request.kind as AssetKind;
			const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(request.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
			const text = request.text.trim().slice(0, 80);
			const merged = request.source === 'all';
			const targets = merged ? sources.filter((source) => source.info.kinds.includes(kind)) : [sourceOf(request.source)];
			if (!merged && !targets[0].info.kinds.includes(kind)) throw new LibraryError(400, `${targets[0].info.name} does not have that kind of asset.`);
			const cursors = merged && request.cursor ? decodeCursor(request.cursor) : null;
			if (merged && request.cursor && !cursors) throw new LibraryError(400, 'Invalid cursor.');
			// In a merged search a source that is missing from the cursor has no more pages.
			const asked = cursors ? targets.filter((source) => source.info.id in cursors) : targets;
			const answers = await Promise.allSettled(asked.map((source) => source.search({ text, kind, limit, filters: request.filters, cursor: merged ? cursors?.[source.info.id] : request.cursor }, signal)));
			const errors: { source: string; message: string }[] = [];
			const lists: AssetSummary[][] = [];
			const next: Record<string, string> = {};
			let total: number | undefined = 0;
			answers.forEach((answer, index) => {
				const source = asked[index];
				if (answer.status === 'rejected') {
					if (!merged) throw asLibraryError(answer.reason);
					errors.push({ source: source.info.id, message: asLibraryError(answer.reason).message });
					return;
				}
				const valid = answer.value.items.filter((item) => {
					const problems = checkSummary(item);
					if (problems.length) console.error(`[library] ${source.info.id} returned an unusable item`, problems.slice(0, 3));
					return problems.length === 0 && item.kind === kind;
				});
				lists.push(valid);
				if (answer.value.next) next[source.info.id] = answer.value.next;
				total = total !== undefined && answer.value.total !== undefined ? total + answer.value.total : undefined;
			});
			if (merged && errors.length === asked.length && asked.length > 0) throw new LibraryError(502, 'No source could answer right now.');
			// Copies are dropped before the sources take turns, so a source whose results were mostly copies does not leave holes in the page.
			const infos = sources.map((source) => source.info);
			let items = interleave(lists.map((list) => dropCovered(list, infos)));
			if (request.filters?.commercialOnly) items = items.filter((item) => allowsCommercialUse(item.license));
			if (request.filters?.importableOnly !== false) items = items.filter((item) => item.downloadable);
			const cursorOut = merged ? (Object.keys(next).length ? encodeCursor(next) : null) : (next[asked[0].info.id] ?? null);
			return { items, next: cursorOut, ...(total !== undefined ? { total } : {}), ...(errors.length ? { errors } : {}) };
		},

		detail,

		/** The bytes of one file of one variant. The address comes from the source's own detail, never from the request. */
		async file(ref: string, variantId: string, role: string, index = 0, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string; filename: string }> {
			const found = await detail(ref, signal);
			const source = sourceOf(parseAssetRef(ref)!.source);
			if (source.info.access === 'link' || !found.downloadable) throw new LibraryError(409, `This asset has to be taken from ${source.info.name}'s own site.`);
			const variant = found.variants.find((candidate) => candidate.id === variantId);
			if (!variant) throw new LibraryError(404, 'That version does not exist.');
			if (variant.unsupported) throw new LibraryError(409, variant.unsupported);
			const file = variant.files.filter((candidate) => candidate.role === role)[Math.max(0, Math.floor(index))];
			if (!file) throw new LibraryError(404, 'That file does not exist.');
			const limit = file.role === 'model' ? ASSET_LIMITS.maxBytes : MAP_BYTES;
			try {
				const opened = source.open ? await source.open(file, signal) : null;
				if (opened) {
					if (opened.bytes.byteLength > limit) throw new LibraryError(413, 'This file is too large to import.');
					return { ...opened, filename: fileName(found.title, role, file.format) };
				}
				if (file.includes?.length) throw new LibraryError(409, 'This model comes as several files and can not be imported yet.');
				const fetched = await fetchLimited(file.url, { allowedHosts: source.info.allowedHosts, maxBytes: limit, signal });
				return { ...fetched, filename: fileName(found.title, role, file.format) };
			} catch (error) { throw asLibraryError(error); }
		}
	};
}

export type Library = ReturnType<typeof createLibrary>;
