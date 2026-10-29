import { formatAssetRef } from '@kithin/engine/library/ref';
import type { AssetDetail, AssetSource, AssetSummary, License, SearchPage, SearchQuery } from '@kithin/engine/library/types';
import { createJsonClient, LibraryError } from '../http';

/**
 * Free To Use (https://freetouse.com/api): royalty-free music tracks, no key. Its license is not CC0: free use has conditions (credit)
 * and commercial use needs a paid license, so the license says commercial use is unknown and the app treats that as not allowed
 * wherever it matters. Tracks are MP3 files on its CDN.
 */
interface Track {
	id: string;
	title: string;
	duration?: number;
	genre?: string;
	artists?: [number, { id: string; name: string }][];
	categories?: [number, { id: string; name: string }][];
	tags?: [number, string][];
	thumbnails?: { sm?: string; md?: string };
	files?: { mp3?: string };
	is_premium?: boolean;
	status?: number;
}
interface TrackList { ok?: boolean; data?: Track[]; pagination?: { limit?: number; offset?: number; count?: number } }
interface TrackOne { ok?: boolean; data?: Track }

const LICENSE: License = { name: 'Free To Use License', url: 'https://freetouse.com/license', commercialUse: 'unknown', attributionRequired: true };
const https = (value: unknown): string | undefined => (typeof value === 'string' && value.startsWith('https://') ? value : undefined);

export function createFreeToUseSource(): AssetSource {
	const getJson = createJsonClient({ base: 'https://api.freetouse.com', name: 'Free To Use', requestsPerMinute: 60 });

	const summary = (track: Track): AssetSummary | null => {
		const mp3 = https(track.files?.mp3);
		if (!track.id || !track.title || !mp3 || track.is_premium) return null;
		const thumbnail = https(track.thumbnails?.md) ?? https(track.thumbnails?.sm);
		const artist = track.artists?.map(([, artist]) => artist.name).join(', ');
		const categories = (track.categories ?? []).map(([, category]) => category.name);
		return {
			ref: formatAssetRef('freetouse', track.id), kind: 'audio', title: track.title, ...(thumbnail ? { thumbnailUrl: thumbnail } : {}), ...(artist ? { author: artist } : {}),
			license: LICENSE, tags: [...(track.tags ?? []).map(([, tag]) => tag), ...(track.genre ? [track.genre] : [])], ...(categories.length ? { categories } : {}),
			sourceUrl: `https://freetouse.com/music/${encodeURIComponent(track.id)}`, downloadable: true
		};
	};

	return {
		info: { id: 'freetouse', name: 'Free To Use', homepage: 'https://freetouse.com', kinds: ['audio'], access: 'api', allowedHosts: ['*.freetouse.com'], defaultLicense: LICENSE },

		async search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage> {
			if (query.kind !== 'audio') throw new LibraryError(400, 'Free To Use has music.');
			const limit = Math.max(1, Math.min(query.limit ?? 24, 100));
			const offset = Math.max(0, Number(query.cursor ?? 0) || 0);
			const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
			const text = query.text.trim();
			if (text) params.set('query', text);
			const answer = await getJson<TrackList>(`/v3/music/tracks/${text ? 'search' : 'all'}?${params}`, signal);
			if (!Array.isArray(answer.data)) throw new LibraryError(502, 'Free To Use returned an unreadable answer.');
			const items = answer.data.map(summary).filter((item): item is AssetSummary => item !== null);
			const count = answer.pagination?.count;
			return { items, next: typeof count === 'number' ? (offset + limit < count ? String(offset + limit) : null) : (answer.data.length >= limit ? String(offset + limit) : null), ...(typeof count === 'number' ? { total: count } : {}) };
		},

		async detail(nativeId: string, signal?: AbortSignal): Promise<AssetDetail> {
			if (!/^[\w-]+$/.test(nativeId)) throw new LibraryError(404, 'Free To Use does not have that.');
			const answer = await getJson<TrackOne>(`/v3/music/tracks/${nativeId}`, signal).catch(() => { throw new LibraryError(404, 'Free To Use does not have that.'); });
			const found = answer.data ? summary(answer.data) : null;
			if (!found) throw new LibraryError(404, 'Free To Use does not have that.');
			const mp3 = answer.data!.files!.mp3!;
			return { ...found, variants: [{ id: 'mp3', label: 'MP3', format: 'mp3', files: [{ role: 'audio', url: mp3, format: 'mp3' }] }] };
		}
	};
}

export const freeToUseSource: AssetSource = createFreeToUseSource();
