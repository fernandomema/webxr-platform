/** The side, in pixels, that the packed normal and height maps are drawn at at most. */
export const PACK_MAX_SIDE = 1024;

/**
 * Babylon's parallax reads the height from the alpha of the normal map, so the two maps are drawn together: the normal's red, green
 * and blue with the height map's red as alpha. Both are RGBA pixels of the same size; without a normal map a flat one stands in.
 */
export function packNormalHeight(normal: ArrayLike<number> | null, height: ArrayLike<number>, pixels: number): Uint8Array {
	const packed = new Uint8Array(pixels * 4);
	for (let i = 0; i < pixels; i++) {
		const at = i * 4;
		packed[at] = normal ? normal[at] : 128;
		packed[at + 1] = normal ? normal[at + 1] : 128;
		packed[at + 2] = normal ? normal[at + 2] : 255;
		packed[at + 3] = height[at];
	}
	return packed;
}

/** The size the packed maps are drawn at: the picture's own, brought under `PACK_MAX_SIDE` on its longer side. */
export function packSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, PACK_MAX_SIDE / Math.max(width, height, 1));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
