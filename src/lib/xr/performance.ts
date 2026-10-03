/** Conservative Quest defaults: leave GPU headroom instead of chasing the headset's highest refresh rate. */
export const XR_FRAMEBUFFER_SCALE = 0.8;
export const MIN_STORE_FRAME_RATE = 72;

/**
 * Resolve the refresh rate for a session. A user choice wins when the headset offers it; otherwise use the lowest
 * supported rate that remains above Meta's 60 FPS floor. The lower target gives each frame the largest stable budget.
 */
export function selectTargetFrameRate(supported: readonly number[], requested: number | null): number | null {
	const rates = [...supported].filter((rate) => Number.isFinite(rate) && rate > 0).sort((a, b) => a - b);
	if (requested !== null && rates.includes(requested)) return requested;
	return rates.find((rate) => rate >= MIN_STORE_FRAME_RATE) ?? rates.find((rate) => rate > 60) ?? null;
}
