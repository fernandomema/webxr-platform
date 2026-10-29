import { CC0 } from '@kithin/engine/library/license';
import { formatAssetRef } from '@kithin/engine/library/ref';
import type { AssetDetail, AssetSource, AssetSummary, FileRole, RemoteFile, SearchPage, SearchQuery, Variant } from '@kithin/engine/library/types';
import { createJsonClient, LibraryError } from '../http';

/**
 * Lazytextures (https://lazytextures.com/PublicAPI): CC0 PBR materials. The API is also served on the default https port, which is the
 * only one files may be fetched from. Its models are FBX and its HDRIs are not imported here, so only materials are served.
 *
 * An asset is named by its category and name, joined by `~` (`Stone~Brickwall01`): its folder holds an `Infos.json` with every map of
 * every resolution as a PNG of its own, so nothing has to be unpacked from a ZIP.
 */
interface LazyAsset { name: string; category?: string; type?: string; basePath: string; preview?: { path?: string }; tags?: string[]; downloads?: { total?: number } }
interface LazyList { success?: boolean; data?: LazyAsset[]; results?: LazyAsset[]; pagination?: { total?: number; hasMore?: boolean; nextOffset?: number } }
interface LazyInfos { textures?: Record<string, { name: string; type: string; path: string }[]> }

const BASE = 'https://lazytextures.net';
const PAGE = 'Materials';
const ID_SEPARATOR = '~';

const MAP_ROLES: Record<string, FileRole> = {
	color: 'albedo', diffuse: 'albedo', albedo: 'albedo', basecolor: 'albedo', normal: 'normal', normalgl: 'normal', roughness: 'roughness', ao: 'ao', ambientocclusion: 'ao',
	metalness: 'metallic', metallic: 'metallic', opacity: 'opacity', emission: 'emissive', emissive: 'emissive', arm: 'arm'
};
const mapRole = (type: string): FileRole | null => MAP_ROLES[type.toLowerCase().replace(/[^a-z]/g, '')] ?? null;

export function createLazytexturesSource(): AssetSource {
	const getJson = createJsonClient({ base: BASE, name: 'Lazytextures', requestsPerMinute: 60 });
	const nativeId = (asset: LazyAsset): string => `${asset.category ?? ''}${ID_SEPARATOR}${asset.name}`;

	const summary = (asset: LazyAsset): AssetSummary | null => {
		if (!asset.name || !asset.basePath?.startsWith('/Assets/Materials/')) return null;
		const thumbnail = asset.preview?.path?.startsWith('/') ? `${BASE}${asset.preview.path}` : undefined;
		return {
			ref: formatAssetRef('lazytextures', nativeId(asset)), kind: 'material', title: asset.name.replace(/_/g, ' '), ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
			license: CC0, tags: (asset.tags ?? []).filter((tag) => tag !== asset.name), ...(asset.category ? { categories: [asset.category] } : {}), sourceUrl: `https://lazytextures.com/`, downloadable: true
		};
	};

	return {
		info: { id: 'lazytextures', name: 'Lazytextures', homepage: 'https://lazytextures.com', kinds: ['material'], access: 'api', allowedHosts: ['lazytextures.net'], defaultLicense: CC0 },

		async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage> {
			if (query.kind !== 'material') throw new LibraryError(400, 'Lazytextures has materials here.');
			const limit = Math.max(1, Math.min(query.limit ?? 24, 100));
			const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
			const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			const text = query.text.trim();
			if (text) params.set('q', text);
			else params.set('sort', 'downloads-desc');
			if (query.filters?.category) params.set('category', query.filters.category);
			const answer = await getJson<LazyList>(text || query.filters?.category ? `/materials/Search?${params}` : `/previews-paginated/materials?${params}`, signal);
			const rows = answer.results ?? answer.data ?? [];
			const items = rows.map(summary).filter((item): item is AssetSummary => item !== null);
			const total = answer.pagination?.total;
			return { items, next: answer.pagination?.hasMore ? String(answer.pagination.nextOffset ?? offset + limit) : null, ...(typeof total === 'number' ? { total } : {}) };
		},

		async detail(id: string, signal?: AbortSignal): Promise<AssetDetail> {
			const cut = id.indexOf(ID_SEPARATOR);
			const category = id.slice(0, cut);
			const name = id.slice(cut + 1);
			if (cut < 1 || !name || !/^[\w.-]+$/.test(category) || !/^[\w.-]+$/.test(name)) throw new LibraryError(404, 'Lazytextures does not have that.');
			const base = `/Assets/${PAGE}/${category}/${name}`;
			const infos = await getJson<LazyInfos>(`${base}/Infos.json`, signal).catch(() => { throw new LibraryError(404, 'Lazytextures does not have that.'); });
			const variants: Variant[] = [];
			for (const [resolution, maps] of Object.entries(infos.textures ?? {})) {
				const files: RemoteFile[] = [];
				for (const map of maps) {
					const role = mapRole(map.type);
					if (!role || !/\.(png|jpe?g)$/i.test(map.name) || !map.path?.startsWith(`${base}/`) || files.some((file) => file.role === role)) continue;
					files.push({ role, url: `${BASE}${map.path}`, format: map.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg' });
				}
				if (files.some((file) => file.role === 'albedo' || file.role === 'normal')) {
					variants.push({ id: resolution, label: resolution.toUpperCase(), resolution, format: files[0].format, files });
				}
			}
			variants.sort((a, b) => parseInt(a.resolution ?? '0') - parseInt(b.resolution ?? '0'));
			// Each map is sent as it is, so 8k maps are flagged rather than left to fail midway.
			for (const variant of variants) if (parseInt(variant.resolution ?? '0') >= 8) variant.unsupported = `${variant.label} maps are too large for Kithin.`;
			const found = summary({ name, category, basePath: `${base}`, preview: { path: `${base}/Preview.png` } });
			if (!found) throw new LibraryError(404, 'Lazytextures does not have that.');
			return { ...found, downloadable: variants.some((variant) => !variant.unsupported), variants };
		}
	};
}

export const lazytexturesSource: AssetSource = createLazytexturesSource();
