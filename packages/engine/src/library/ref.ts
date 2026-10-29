import type { AssetRef } from './types.ts';

const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,30}$/;

export const isSourceId = (value: unknown): value is string => typeof value === 'string' && SOURCE_ID.test(value);

/** The native id may hold colons (an aggregator's own ids do), so only the first one separates the source. */
export function formatAssetRef(source: string, nativeId: string): AssetRef {
	if (!isSourceId(source)) throw new Error(`Invalid source id: ${source}`);
	if (!nativeId || nativeId.length > 200 || /[\u0000-\u001f\u007f]/.test(nativeId)) throw new Error('Invalid asset id.');
	return `${source}:${nativeId}`;
}

export function parseAssetRef(value: unknown): { source: string; nativeId: string } | null {
	if (typeof value !== 'string') return null;
	const cut = value.indexOf(':');
	if (cut < 1) return null;
	const source = value.slice(0, cut);
	const nativeId = value.slice(cut + 1);
	if (!isSourceId(source) || !nativeId || nativeId.length > 200 || /[\u0000-\u001f\u007f]/.test(nativeId)) return null;
	return { source, nativeId };
}
