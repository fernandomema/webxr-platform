import { ASSET_LIMITS } from '@kithin/engine/assets/limits';
import { CC0 } from '@kithin/engine/library/license';
import { formatAssetRef } from '@kithin/engine/library/ref';
import type { AssetDetail, AssetSource, AssetSummary, RemoteFile, SearchPage, SearchQuery, Variant } from '@kithin/engine/library/types';
import { polyHavenGlb, polyHavenModelInfo, polyHavenTextureFiles, searchPolyHaven, searchPolyHavenTextures } from '../../polyHaven';
import { textureVariants } from '../../polyHavenTextures';
import { LibraryError } from '../http';

const MODEL_URL = 'polyhaven://model/';

/** A model has no single file to fetch: Poly Haven serves a glTF with companions, which `open` assembles into one GLB. */
const modelUrl = (id: string) => `${MODEL_URL}${id}`;

const page = (cursor: string | undefined): number => {
	const value = Number(cursor ?? 0);
	return Number.isInteger(value) && value >= 0 && value < 1000 ? value : 0;
};

const sourceUrl = (id: string) => `https://polyhaven.com/a/${id}`;

/**
 * Poly Haven, directly: CC0 models and PBR materials ("textures" in its own words). The rules for reading its library are the ones
 * the in-world material shop uses, so there is one place that knows how Poly Haven names things.
 */
export const polyHavenSource: AssetSource = {
	info: {
		id: 'polyhaven',
		name: 'Poly Haven',
		homepage: 'https://polyhaven.com',
		kinds: ['model', 'material'],
		access: 'api',
		allowedHosts: ['dl.polyhaven.org'],
		defaultLicense: CC0
	},

	async search(query: SearchQuery): Promise<SearchPage> {
		const limit = query.limit ?? 24;
		const index = page(query.cursor);
		if (query.kind === 'model') {
			const found = await searchPolyHaven(query.text, index, limit);
			const items: AssetSummary[] = found.results.map((model) => ({
				ref: formatAssetRef('polyhaven', model.id), kind: 'model', title: model.name, ...(model.thumbnail.startsWith('https://') ? { thumbnailUrl: model.thumbnail } : {}),
				license: CC0, tags: model.tags, categories: model.category ? [model.category] : [], sourceUrl: sourceUrl(model.id), downloadable: true, facts: { polyCount: model.polycount }
			}));
			return { items, next: (index + 1) * limit < found.total ? String(index + 1) : null, total: found.total };
		}
		if (query.kind === 'material') {
			const found = await searchPolyHavenTextures(query.text, index, limit);
			const items: AssetSummary[] = found.results.map((texture) => ({
				ref: formatAssetRef('polyhaven', texture.id), kind: 'material', title: texture.name, ...(texture.thumbnail.startsWith('https://') ? { thumbnailUrl: texture.thumbnail } : {}),
				license: CC0, tags: [], categories: texture.category ? [texture.category] : [], sourceUrl: sourceUrl(texture.id), downloadable: true, facts: { realWorldSize: texture.size }
			}));
			return { items, next: (index + 1) * limit < found.total ? String(index + 1) : null, total: found.total };
		}
		throw new LibraryError(400, 'Poly Haven has models and materials.');
	},

	async detail(nativeId: string): Promise<AssetDetail> {
		const model = await polyHavenModelInfo(nativeId);
		if (model) {
			const tooBig = model.polycount > ASSET_LIMITS.maxTriangles;
			const variant: Variant = {
				id: 'glb', label: 'GLB · 1k textures', resolution: '1k', format: 'glb',
				files: [{ role: 'model', url: modelUrl(nativeId), format: 'glb' }],
				...(tooBig ? { unsupported: 'This model has too many polygons for Kithin.' } : {})
			};
			return {
				ref: formatAssetRef('polyhaven', nativeId), kind: 'model', title: model.name, description: model.description || undefined, ...(model.thumbnail.startsWith('https://') ? { thumbnailUrl: model.thumbnail } : {}),
				license: CC0, tags: model.tags, categories: model.category ? [model.category] : [], sourceUrl: sourceUrl(nativeId), downloadable: true, facts: { polyCount: model.polycount }, variants: [variant]
			};
		}
		const texture = await polyHavenTextureFiles(nativeId);
		if (!texture) throw new LibraryError(404, 'Poly Haven does not have that.');
		const variants: Variant[] = textureVariants(texture.files).map(({ resolution, maps }) => {
			const files: RemoteFile[] = maps.map(({ role, file }) => ({ role, url: file.url, format: file.url.toLowerCase().endsWith('.png') ? 'png' : 'jpg', sizeBytes: file.size }));
			return { id: resolution, label: resolution.toUpperCase(), resolution, format: 'jpg', totalBytes: files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0), files };
		});
		return {
			ref: formatAssetRef('polyhaven', nativeId), kind: 'material', title: texture.name, ...(texture.thumbnail.startsWith('https://') ? { thumbnailUrl: texture.thumbnail } : {}),
			license: CC0, tags: [], categories: texture.category ? [texture.category] : [], sourceUrl: sourceUrl(nativeId), downloadable: variants.length > 0,
			facts: { realWorldSize: texture.size, maps: [...new Set(variants.flatMap((variant) => variant.files.map((file) => file.role)))], resolutions: variants.map((variant) => variant.id) }, variants
		};
	},

	async open(file: RemoteFile) {
		if (!file.url.startsWith(MODEL_URL)) return null;
		return { bytes: await polyHavenGlb(file.url.slice(MODEL_URL.length)), contentType: 'model/gltf-binary' };
	}
};
