/** Import budgets. They protect standalone headsets, and are re-checked on everything received. */
export const ASSET_LIMITS = {
	maxBytes: 25 * 1024 * 1024,
	maxTriangles: 300_000,
	maxImages: 24,
	/** Distinct assets (of any type) a single world may reference. */
	maxAssetsPerWorld: 64
} as const;
