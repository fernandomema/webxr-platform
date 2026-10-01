/**
 * Turns the six faces of a cube map into one equirectangular (360°) picture. Pure, so it is tested in Node.
 *
 * The output looks along -Z at its centre, with -X to the right, +Y up: the panorama a person standing at the
 * cube's centre and facing -Z would see. Faces are in the usual order: +X, -X, +Y, -Y, +Z, -Z, each a square RGBA
 * image with row 0 at the top as it looks from inside the cube. The panorama is rotated 180 degrees around Y.
 */

export const FACE_ORDER = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;

/** Which face a direction lands on and where (0 to 1, from the top-left of that face). Standard cube-map addressing. */
export function faceLookup(x: number, y: number, z: number): { face: number; u: number; v: number } {
	const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
	let face: number, sc: number, tc: number, ma: number;
	if (ax >= ay && ax >= az) {
		ma = ax;
		if (x > 0) [face, sc, tc] = [0, -z, -y];
		else [face, sc, tc] = [1, z, -y];
	} else if (ay >= az) {
		ma = ay;
		if (y > 0) [face, sc, tc] = [2, x, z];
		else [face, sc, tc] = [3, x, -z];
	} else {
		ma = az;
		if (z > 0) [face, sc, tc] = [4, x, -y];
		else [face, sc, tc] = [5, -x, -y];
	}
	return { face, u: (sc / ma + 1) / 2, v: (tc / ma + 1) / 2 };
}

/** Reading a texture back gives its bottom row first; the addressing above wants the top row first. */
export function flipRows(face: Uint8Array, faceSize: number): Uint8Array {
	const out = new Uint8Array(face.length);
	const stride = faceSize * 4;
	for (let row = 0; row < faceSize; row++) out.set(face.subarray((faceSize - 1 - row) * stride, (faceSize - row) * stride), row * stride);
	return out;
}

/** `faces` are six RGBA byte arrays of `faceSize`². Returns `width`×`height` RGBA bytes. */
export function cubeToEquirect(faces: readonly Uint8Array[], faceSize: number, width: number, height: number): Uint8ClampedArray {
	if (faces.length !== 6) throw new Error('A cube map has six faces');
	const out = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row++) {
		const lat = (0.5 - (row + 0.5) / height) * Math.PI; // +PI/2 at the top
		const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
		for (let column = 0; column < width; column++) {
			const lon = ((column + 0.5) / width - 0.5) * 2 * Math.PI + Math.PI; // Centre faces -Z after a half turn around Y
			const { face, u, v } = faceLookup(cosLat * Math.sin(lon), sinLat, cosLat * Math.cos(lon));
			const px = Math.min(faceSize - 1, Math.floor(u * faceSize));
			const py = Math.min(faceSize - 1, Math.floor(v * faceSize));
			const from = (py * faceSize + px) * 4;
			const to = (row * width + column) * 4;
			const source = faces[face];
			out[to] = source[from];
			out[to + 1] = source[from + 1];
			out[to + 2] = source[from + 2];
			out[to + 3] = source[from + 3];
		}
	}
	return out;
}
