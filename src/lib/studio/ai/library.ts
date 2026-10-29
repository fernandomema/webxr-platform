import { describeLicense } from '@kithin/engine/library/license';
import { ASSET_KINDS, type AssetKind } from '@kithin/engine/library/types';
import { getAssetDetail, searchLibrary } from '../library/client';
import { browserImportDeps } from '../library/deps';
import { importFromLibrary, canImportKind } from '../library/importers';

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
