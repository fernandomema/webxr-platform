import type { Variant } from './types.ts';

/** "1k" is 1024, "512" is 512; anything else has no size. */
export function resolutionPixels(resolution: string | undefined): number | null {
	const match = /^(\d+(?:\.\d+)?)(k?)$/i.exec((resolution ?? '').trim());
	if (!match) return null;
	return Math.round(Number(match[1]) * (match[2] ? 1024 : 1));
}

export interface VariantPreference {
	/** The size wanted; the closest one is taken, the smaller on a tie (lighter on a headset). */
	resolution?: string;
	/** Formats in order of preference; a variant in an earlier one wins whatever its size. */
	formats?: string[];
}

/** The variant that best matches what is wanted among those that can be imported, or null when none can. */
export function pickVariant(variants: readonly Variant[], preference: VariantPreference = {}): Variant | null {
	const usable = variants.filter((variant) => !variant.unsupported && variant.files.length > 0);
	let pool = usable;
	for (const format of preference.formats ?? []) {
		const matching = usable.filter((variant) => variant.format.toLowerCase() === format.toLowerCase());
		if (matching.length) { pool = matching; break; }
	}
	if (!pool.length) return null;
	const wanted = resolutionPixels(preference.resolution ?? '1k') ?? 1024;
	let best: Variant | null = null;
	let bestScore = Infinity;
	let bestPixels = Infinity;
	for (const variant of pool) {
		const pixels = resolutionPixels(variant.resolution);
		const score = pixels === null ? Infinity - 1 : Math.abs(Math.log2(pixels / wanted));
		if (best === null || score < bestScore || (score === bestScore && (pixels ?? Infinity) < bestPixels)) { best = variant; bestScore = score; bestPixels = pixels ?? Infinity; }
	}
	return best;
}
