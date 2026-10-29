import { describeLicense } from '@kithin/engine/library/license';
import { ASSET_KINDS, type AssetKind } from '@kithin/engine/library/types';
import { cloudAssets } from '@kithin/engine/assets/cloud';
import { getLocalAssetStore } from '@kithin/engine/assets/store';
import { getAssetDetail, searchLibrary } from '../library/client';
import { browserImportDeps } from '../library/deps';
import { importFromLibrary, canImportKind } from '../library/importers';

/** The assets the person already owns (uploaded or saved, locally or in the cloud), so the agent reuses them before downloading anything. */
export async function listOwnAssets(input: { kind?: unknown; query?: unknown }) {
	const kind = typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim() : null;
	const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
	const [local, cloud] = await Promise.all([getLocalAssetStore().list(), cloudAssets.list().catch(() => [])]);
	const seen = new Set<string>();
	const assets: unknown[] = [];
	for (const manifest of [...local, ...cloud.map((entry) => entry.manifest)]) {
		if (seen.has(manifest.assetId)) continue;
		seen.add(manifest.assetId);
		if (kind && manifest.type !== kind) continue;
		if (query && !manifest.name.toLowerCase().includes(query)) continue;
		assets.push({
			assetId: manifest.assetId,
			type: manifest.type,
			name: manifest.name,
			...(manifest.type === 'model' ? { bounds: manifest.bounds, triangles: manifest.triangles } : {}),
			...(manifest.type === 'audio' ? { duration: manifest.duration } : {})
		});
		if (assets.length >= 40) break;
	}
	return { assets };
}

/** The AI's way to the online libraries: the same search and import the Studio's own browser uses, with answers kept short for the model. */
export async function searchAssets(input: { kind?: unknown; query?: unknown; source?: unknown }, signal?: AbortSignal) {
	const kind = String(input.kind ?? '');
	if (!ASSET_KINDS.includes(kind as AssetKind)) throw new Error(`kind must be one of: ${ASSET_KINDS.filter(canImportKind).join(', ')}.`);
	const found = await searchLibrary({ source: typeof input.source === 'string' && input.source ? input.source : 'all', kind: kind as AssetKind, text: String(input.query ?? ''), limit: 12 }, signal);
	return {
		total: found.total,
		results: found.items.map((item) => ({ ref: item.ref, title: item.title, license: describeLicense(item.license), ...(item.author ? { author: item.author } : {}), ...(item.facts?.polyCount ? { polyCount: item.facts.polyCount } : {}), ...(item.facts?.realWorldSize ? { realWorldSize: item.facts.realWorldSize } : {}), downloadable: item.downloadable })),
		hasMore: found.next !== null,
		note: canImportKind(kind as AssetKind) ? undefined : `Importing ${kind} is not available yet; the results can only be named.`
	};
}

export async function importAssetByRef(input: { ref?: unknown; resolution?: unknown; variant?: unknown }, signal?: AbortSignal) {
	const detail = await getAssetDetail(String(input.ref ?? ''), signal);
	const imported = await importFromLibrary(detail, browserImportDeps, {
		signal,
		...(typeof input.resolution === 'string' ? { resolution: input.resolution } : {}),
		...(typeof input.variant === 'string' ? { variantId: input.variant } : {})
	});
	return { ...imported, license: describeLicense(detail.license), credit: detail.license.attributionRequired === true ? `Credit ${detail.author ?? 'the author'} (${detail.sourceUrl}).` : undefined };
}
