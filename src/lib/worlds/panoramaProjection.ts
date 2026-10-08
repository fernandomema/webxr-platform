/**
 * Draws a normal (rectilinear) view out of an equirectangular 360° picture, so a world preview can be shown without the
 * stretching a flat crop of the whole panorama has, and looked around in by changing yaw and pitch. Pure, so it is tested in Node.
 *
 * Yaw turns the view to the right (radians), pitch looks up. Yaw 0, pitch 0 looks at the middle of the picture.
 */

export interface Pixels {
	width: number;
	height: number;
	/** RGBA bytes, row 0 at the top. */
	data: Uint8ClampedArray;
}

/** Fills `out` (RGBA, `outWidth`×`outHeight`) with the view; `hfov` is the horizontal field of view in radians. */
export function renderView(source: Pixels, out: Uint8ClampedArray, outWidth: number, outHeight: number, yaw: number, pitch: number, hfov: number): void {
	const focal = outWidth / 2 / Math.tan(hfov / 2);
	const sinP = Math.sin(pitch), cosP = Math.cos(pitch);
	const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
	const { width: sw, height: sh, data } = source;
	let index = 0;
	for (let py = 0; py < outHeight; py++) {
		const y0 = outHeight / 2 - (py + 0.5);
		for (let px = 0; px < outWidth; px++) {
			const x0 = px + 0.5 - outWidth / 2;
			// pitch around X, then yaw around Y (camera looks down +Z before rotating)
			const y1 = y0 * cosP + focal * sinP;
			const z1 = -y0 * sinP + focal * cosP;
			const x2 = x0 * cosY + z1 * sinY;
			const z2 = -x0 * sinY + z1 * cosY;
			const length = Math.hypot(x2, y1, z2);
			const lon = Math.atan2(x2, z2);
			const lat = Math.asin(y1 / length);
			let fx = (lon / (2 * Math.PI) + 0.5) * sw - 0.5;
			const fy = Math.min(sh - 1, Math.max(0, (0.5 - lat / Math.PI) * sh - 0.5));
			// bilinear; the horizontal axis wraps around the 360°
			const x0i = Math.floor(fx), y0i = Math.floor(fy);
			const tx = fx - x0i, ty = fy - y0i;
			const xa = ((x0i % sw) + sw) % sw, xb = (xa + 1) % sw;
			const ya = y0i, yb = Math.min(sh - 1, y0i + 1);
			const a = (ya * sw + xa) * 4, b = (ya * sw + xb) * 4, c = (yb * sw + xa) * 4, d = (yb * sw + xb) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const top = data[a + channel] * (1 - tx) + data[b + channel] * tx;
				const bottom = data[c + channel] * (1 - tx) + data[d + channel] * tx;
				out[index + channel] = top * (1 - ty) + bottom * ty;
			}
			out[index + 3] = 255;
			index += 4;
		}
	}
}
