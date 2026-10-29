import type { AssetSummary, SourceInfo } from './types.ts';
import { parseAssetRef } from './ref.ts';

/**
 * Drops from an aggregator's results the assets that a direct source also serves (the aggregator names the sources it includes in
 * `covers`), so a merged search does not show the same asset twice. `AssetRef`s of an aggregator carry the original source after
 * its own id: `shep:polyhaven:Chair` is Poly Haven's `Chair`.
 */
export function dropCovered(items: readonly AssetSummary[], infos: readonly SourceInfo[]): AssetSummary[] {
	const direct = new Set(infos.map((info) => info.id));
	const covered = new Map(infos.filter((info) => info.covers?.length).map((info) => [info.id, new Set(info.covers)]));
	return items.filter((item) => {
		const parsed = parseAssetRef(item.ref);
		const covers = parsed ? covered.get(parsed.source) : undefined;
		if (!parsed || !covers) return true;
		const inner = parseAssetRef(parsed.nativeId);
		return !(inner && covers.has(inner.source) && direct.has(inner.source));
	});
}

/** Takes one item from each list in turn, so no source buries the others in a merged page. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
	const result: T[] = [];
	for (let index = 0; lists.some((list) => index < list.length); index++) for (const list of lists) if (index < list.length) result.push(list[index]);
	return result;
}
