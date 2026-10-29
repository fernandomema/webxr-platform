import { ASSET_LIMITS } from '@kithin/engine/assets/limits';
import { CC0 } from '@kithin/engine/library/license';
import { formatAssetRef } from '@kithin/engine/library/ref';
import type { AssetDetail, AssetSource, AssetSummary, SearchPage, SearchQuery, Variant } from '@kithin/engine/library/types';
import { createJsonClient, LibraryError } from '../http';

/**
 * Grab3D (https://grab3d.com/developers): CC0 models, listed in one static file (`/api/v1/models.json`, several MB) that the site asks
 * to be cached rather than fetched on every start. So the whole catalog is read once an hour and searched here. Every model comes as a
 * GLB (a `full` one and, for some, a `light` one), which is the only format imported; the others are not offered.
 */
interface Grab3dFile { format: string; variant: string; bytes?: number; url: string }
interface Grab3dModel {
	slug: string;
	name: { en?: string } & Record<string, string | undefined>;
	summary?: string;
	category?: string;
	categoryName?: string;
	tags?: string[];
	license?: string;
	specs?: { triangles?: number; trianglesLight?: number; texturePx?: number; texturePxLight?: number; maps?: string[]; movingParts?: unknown[] };
	media?: { thumbnail?: string; thumbnailSmall?: string };
	rigged?: boolean;
	files?: Grab3dFile[];
}

const BASE = 'https://grab3d.com';
const https = (value: unknown): string | undefined => (typeof value === 'string' && value.startsWith('https://') ? value : undefined);
const title = (model: Grab3dModel): string => model.name?.en || model.slug;
const sourceUrl = (model: Grab3dModel): string => `${BASE}/models/${encodeURIComponent(model.slug)}`;

export function createGrab3dSource(): AssetSource {
	const getJson = createJsonClient({ base: BASE, name: 'Grab3D', ttlMs: 60 * 60_000, maxBytes: 16 * 1024 * 1024, requestsPerMinute: 30 });
	const catalog = async (signal?: AbortSignal): Promise<Grab3dModel[]> => {
		const answer = await getJson<{ models?: Grab3dModel[] }>('/api/v1/models.json', signal);
		if (!Array.isArray(answer.models)) throw new LibraryError(502, 'Grab3D returned an unreadable answer.');
		// Only what is CC0 and has a GLB is of use here.
		return answer.models.filter((model) => model.slug && model.license === 'CC0-1.0' && model.files?.some((file) => file.format === 'glb'));
	};

	const summary = (model: Grab3dModel): AssetSummary => {
		const thumbnail = https(model.media?.thumbnailSmall) ?? https(model.media?.thumbnail);
		const triangles = model.specs?.trianglesLight ?? model.specs?.triangles;
		return {
			ref: formatAssetRef('grab3d', model.slug), kind: 'model', title: title(model), ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
			license: CC0, tags: model.tags ?? [], ...(model.categoryName ? { categories: [model.categoryName] } : {}), sourceUrl: sourceUrl(model), downloadable: true,
			facts: { ...(triangles ? { polyCount: triangles } : {}), ...(model.rigged !== undefined ? { rigged: model.rigged } : {}), ...(model.specs?.maps?.length ? { maps: model.specs.maps } : {}) }
		};
	};

	const matches = (model: Grab3dModel, words: string[]): boolean => {
		const haystack = [title(model), model.summary ?? '', model.category ?? '', model.categoryName ?? '', ...(model.tags ?? [])].join(' ').toLowerCase();
		return words.every((word) => haystack.includes(word));
	};

	return {
		info: {
			id: 'grab3d', name: 'Grab3D', homepage: 'https://grab3d.com', kinds: ['model'], access: 'api', allowedHosts: ['grab3d.com'], defaultLicense: CC0
		},

		async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage> {
			if (query.kind !== 'model') throw new LibraryError(400, 'Grab3D has models.');
			const limit = Math.max(1, Math.min(query.limit ?? 24, 100));
			const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
			const words = query.text.toLowerCase().split(/\s+/).filter(Boolean);
			const category = query.filters?.category?.toLowerCase();
			const maxPolyCount = query.filters?.maxPolyCount;
			const found = (await catalog(signal)).filter((model) => matches(model, words)
				&& (!category || model.category?.toLowerCase() === category || model.categoryName?.toLowerCase() === category)
				&& (maxPolyCount === undefined || (model.specs?.trianglesLight ?? model.specs?.triangles ?? 0) <= maxPolyCount));
			const items = found.slice(offset, offset + limit).map(summary);
			return { items, next: offset + limit < found.length ? String(offset + limit) : null, total: found.length };
		},

		async detail(nativeId: string, signal?: AbortSignal): Promise<AssetDetail> {
			const model = (await catalog(signal)).find((candidate) => candidate.slug === nativeId);
			if (!model) throw new LibraryError(404, 'Grab3D does not have that.');
			const variants: Variant[] = (model.files ?? []).filter((file) => file.format === 'glb' && https(file.url)).map((file) => {
				const light = file.variant === 'light';
				const triangles = light ? model.specs?.trianglesLight : model.specs?.triangles;
				const texturePx = light ? model.specs?.texturePxLight : model.specs?.texturePx;
				const tooBig = (triangles ?? 0) > ASSET_LIMITS.maxTriangles ? 'This model has too many polygons for Kithin.' : (file.bytes ?? 0) > ASSET_LIMITS.maxBytes ? 'This file is too large for Kithin.' : undefined;
				return {
					id: `glb-${file.variant}`, label: `GLB · ${light ? 'light' : 'full'}${texturePx ? ` · ${texturePx}px` : ''}`, ...(texturePx ? { resolution: `${texturePx}px` } : {}), format: 'glb',
					...(file.bytes ? { totalBytes: file.bytes } : {}), files: [{ role: 'model' as const, url: file.url, format: 'glb', ...(file.bytes ? { sizeBytes: file.bytes } : {}) }], ...(tooBig ? { unsupported: tooBig } : {})
				};
			});
			// The light one first, then supported before unsupported, so the first variant is the one to use.
			variants.sort((a, b) => Number(Boolean(a.unsupported)) - Number(Boolean(b.unsupported)) || Number(b.id === 'glb-light') - Number(a.id === 'glb-light'));
			return { ...summary(model), ...(model.summary ? { description: model.summary } : {}), downloadable: variants.some((variant) => !variant.unsupported), variants };
		}
	};
}

export const grab3dSource: AssetSource = createGrab3dSource();
