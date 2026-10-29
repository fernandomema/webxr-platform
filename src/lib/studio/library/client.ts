import type { AssetDetail, AssetKind, AssetSummary } from '@kithin/engine/library/types';

/** The Studio's side of `/api/library/*`: plain calls that turn the routes' `{ message }` errors into errors a person can read. */
export interface SourceLite { id: string; name: string; homepage: string; kinds: AssetKind[]; access: 'api' | 'link' }
export interface SearchResult { items: AssetSummary[]; next: string | null; total?: number; errors?: { source: string; message: string }[] }

async function readError(response: Response, fallback: string): Promise<Error> {
	const body = await response.json().catch(() => null) as { message?: string } | null;
	return new Error(body?.message ?? fallback);
}

export async function listSources(signal?: AbortSignal): Promise<SourceLite[]> {
	const response = await fetch('/api/library/sources', { signal });
	if (!response.ok) throw await readError(response, 'Could not reach the online libraries.');
	return (await response.json() as { sources: SourceLite[] }).sources;
}

export interface SearchParams { source: string; kind: AssetKind; text: string; cursor?: string | null; limit?: number; commercialOnly?: boolean; importableOnly?: boolean }

export async function searchLibrary(params: SearchParams, signal?: AbortSignal): Promise<SearchResult> {
	const query = new URLSearchParams({ source: params.source, kind: params.kind, q: params.text, commercial: String(params.commercialOnly !== false), importable: String(params.importableOnly !== false) });
	if (params.cursor) query.set('cursor', params.cursor);
	if (params.limit) query.set('limit', String(params.limit));
	const response = await fetch(`/api/library/search?${query}`, { signal });
	if (!response.ok) throw await readError(response, 'Could not search right now.');
	return response.json() as Promise<SearchResult>;
}

export async function getAssetDetail(ref: string, signal?: AbortSignal): Promise<AssetDetail> {
	const response = await fetch(`/api/library/assets/${encodeURIComponent(ref)}`, { signal });
	if (!response.ok) throw await readError(response, 'Could not read this asset.');
	return response.json() as Promise<AssetDetail>;
}

export async function downloadLibraryFile(ref: string, variantId: string, role: string, index = 0, signal?: AbortSignal): Promise<Uint8Array> {
	const query = new URLSearchParams({ variant: variantId, role, index: String(index) });
	const response = await fetch(`/api/library/assets/${encodeURIComponent(ref)}/file?${query}`, { signal });
	if (!response.ok) throw await readError(response, 'Could not download this file.');
	return new Uint8Array(await response.arrayBuffer());
}
