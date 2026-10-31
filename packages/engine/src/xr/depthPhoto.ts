/**
 * The depth of a spatial photo, as a grey picture: the nearest thing is white and the farthest black, spread over the range the photo
 * actually has so that its subject fills the whole scale. The scale is the logarithm of the distance, so that two things in a ratio
 * (one twice as far as the other) are as far apart in grey wherever they are; the very nearest and farthest few in a hundred are left
 * out of the range, so that a hand at the lens or a sliver of horizon does not take the whole scale. Pure: no Babylon.
 */

/** Depth values this close to the far limit are what the camera saw nothing of (the sky, the clear colour). */
const NOTHING = 0.999;
/** The share of the seen pixels, at each end, left out of the range. */
const TRIM = 0.02;

/**
 * `depth` is a depth map's pixels (RGBA, the depth in red, a fraction of the camera's range, bottom row first). The result is the
 * same size as RGBA bytes, top row first.
 */
export function encodeDepth(depth: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
	const count = width * height;
	const seen: number[] = [];
	const stride = count > 20_000 ? 3 : 1;
	for (let i = 0; i < count; i += stride) {
		const value = depth[i * 4];
		if (value > 1e-4 && value < NOTHING) seen.push(value);
	}
	seen.sort((a, b) => a - b);
	const near = seen.length ? seen[Math.min(seen.length - 1, Math.floor(seen.length * TRIM))] : 0;
	const far = seen.length ? seen[Math.min(seen.length - 1, Math.floor(seen.length * (1 - TRIM)))] : 0;
	const flat = !(far > near);
	const span = flat ? 1 : Math.log(far) - Math.log(near);
	const out = new Uint8ClampedArray(count * 4);
	for (let row = 0; row < height; row++) {
		for (let column = 0; column < width; column++) {
			const value = depth[((height - 1 - row) * width + column) * 4];
			let grey = 0;
			if (value > 1e-4 && value < NOTHING) grey = flat || value <= near ? 255 : value >= far ? 0 : Math.round(255 * ((Math.log(far) - Math.log(value)) / span));
			const at = (row * width + column) * 4;
			out[at] = out[at + 1] = out[at + 2] = grey;
			out[at + 3] = 255;
		}
	}
	return out;
}

/** Whether a depth map holds anything yet: a depth shader that is still compiling draws nothing, and the map stays at its clear colour. */
export function hasDepth(depth: ArrayLike<number>, width: number, height: number): boolean {
	let seen = 0;
	const count = width * height;
	for (let i = 0; i < count; i++) {
		const value = depth[i * 4];
		if (value > 1e-4 && value < NOTHING) seen++;
	}
	return seen > count * 0.01;
}
