/**
 * Texture coordinates for a material that is laid out by real size rather than stretched over the mesh: one repeat of the
 * picture covers `size` metres of the surface, however the object is scaled. Pure arrays in and out, so it is tested in Node.
 *
 * A mesh's own coordinates run 0 to 1 across each face whatever the face measures, so a wall six metres wide and two and a half
 * high would show the picture squeezed one way. Boxes, planes, floors and the caps of cylinders are projected instead: each
 * vertex takes the two coordinates of its position that run along its face (chosen by its normal), in metres. Spheres and the
 * sides of cylinders keep their own coordinates, which already follow the surface, scaled by how long that surface is.
 *
 * With `wrap` a box is unfolded instead: the top keeps its own coordinates and each side continues them down from the top edge, as
 * if the picture were a sheet folded over the box, so the pattern runs across the top edges without a break (the vertical edges
 * between the sides are where the sheet is cut). The bottom is laid out flat like a plain face.
 *
 * With `wrap: 'around'` the sides are laid out as one strip that goes round the box instead (along the perimeter, down from the top edge),
 * so the vertical edges are continuous and the top edges are the ones that are cut. Top and bottom are laid out flat.
 *
 * Coordinates start at the object's corner, so the picture begins on a whole tile at every edge. With `fit` the repeats along
 * each axis are rounded to a whole number (the picture is stretched by less than half a tile over the length), so it also ends
 * on a whole tile and the faces that meet at an edge show the same grain along it: nothing is cut off at the borders.
 */

export type UvShape = 'box' | 'plane' | 'ground' | 'disc' | 'sphere' | 'cylinder';

const round = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * The coordinates to give a mesh of this shape and scale. `positions`, `normals` and `uvs` are the mesh's own vertex data (in
 * the mesh's unit size); `scale` is how big the object is in the world, per axis. `size` is the metres one repeat covers.
 */
export function worldUvs(shape: UvShape, positions: ArrayLike<number>, normals: ArrayLike<number>, uvs: ArrayLike<number>, scale: readonly [number, number, number], size: number, fit = false, wrap: boolean | 'top' | 'around' = false): Float32Array {
	const out = new Float32Array(uvs.length);
	const metres = size > 0 ? size : 1;
	const [sx, sy, sz] = scale.map(Math.abs) as [number, number, number];
	const around = Math.PI * Math.max(sx, sz);
	// Where the object starts and how long it is along each axis, in metres.
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < positions.length; v += 3) {
		for (let axis = 0; axis < 3; axis++) {
			const coord = positions[v + axis] * [sx, sy, sz][axis];
			if (coord < low[axis]) low[axis] = coord;
			if (coord > high[axis]) high[axis] = coord;
		}
	}
	/** Repeats along a stretch of `length` metres: its real count, or the nearest whole one when fitting (never fewer than one). */
	const repeats = (length: number) => {
		const real = length / metres;
		return fit && real >= 1 ? Math.round(real) : real;
	};
	/** `offset` metres from the start of a stretch of `length`, in repeats. */
	const along = (offset: number, length: number) => (length > 0 ? (offset / length) * repeats(length) : 0);
	for (let i = 0, v = 0; i < out.length; i += 2, v += 3) {
		const nx = Math.abs(normals[v]);
		const ny = Math.abs(normals[v + 1]);
		const nz = Math.abs(normals[v + 2]);
		const x = positions[v] * sx;
		const y = positions[v + 1] * sy;
		const z = positions[v + 2] * sz;
		const flat = shape === 'box' || shape === 'plane' || shape === 'ground' || shape === 'disc' || (shape === 'cylinder' && ny > 0.9);
		if (wrap && shape === 'box') {
			const lx = high[0] - low[0];
			const lz = high[2] - low[2];
			const kx = lx > 0 ? repeats(lx) / lx : 0;
			const kz = lz > 0 ? repeats(lz) / lz : 0;
			// How far below the top edge the vertex is, and where it is along the top.
			const down = high[1] - y;
			const gx = (x - low[0]) * kx;
			const gz = (z - low[2]) * kz;
			const sign = normals[v] + normals[v + 1] + normals[v + 2] > 0 ? 1 : -1;
			let u = gx;
			let w = gz;
			if (ny >= nx && ny >= nz) {
				// Top and bottom: their own position.
			} else if (wrap === 'around') {
				// Round the box from the front-left corner: along the front, up the right side, back along the back, down the left side.
				const ly = high[1] - low[1];
				const ky = ly > 0 ? repeats(ly) / ly : 0;
				const run = nz >= nx ? (sign > 0 ? gx : lx * kx + lz * kz + (high[0] - x) * kx) : sign > 0 ? lx * kx + (high[2] - z) * kz : 2 * lx * kx + lz * kz + gz;
				u = run;
				w = down * ky;
			} else if (nz >= nx) {
				w = sign > 0 ? lz * kz + down * kz : -down * kz;
			} else {
				u = sign > 0 ? lx * kx + down * kx : -down * kx;
			}
			out[i] = round(u);
			out[i + 1] = round(w);
		} else if (flat) {
			// The two axes along the face the vertex is on: a face turned to X shows Z and Y, to Y shows X and Z, to Z shows X and Y.
			const [a, b] = nx >= ny && nx >= nz ? [2, 1] : ny >= nz ? [0, 2] : [0, 1];
			const coords = [x, y, z];
			out[i] = round(along(coords[a] - low[a], high[a] - low[a]));
			out[i + 1] = round(along(coords[b] - low[b], high[b] - low[b]));
		} else if (shape === 'cylinder') {
			out[i] = round(along(uvs[i] * around, around));
			out[i + 1] = round(along(uvs[i + 1] * sy, sy));
		} else {
			out[i] = round(along(uvs[i] * around, around));
			out[i + 1] = round(along(uvs[i + 1] * around * 0.5, around * 0.5));
		}
	}
	return out;
}
