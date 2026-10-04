/**
 * Texture coordinates for a material that is laid out by real size rather than stretched over the mesh: one repeat of the
 * picture covers `size` metres of the surface, however the object is scaled. Pure arrays in and out, so it is tested in Node.
 *
 * A mesh's own coordinates run 0 to 1 across each face whatever the face measures, so a wall six metres wide and two and a half
 * high would show the picture squeezed one way. Boxes, planes, floors and the caps of cylinders are projected instead: each
 * vertex takes the two coordinates of its position that run along its face (chosen by its normal), in metres. Spheres and the
 * sides of cylinders keep their own coordinates, which already follow the surface, scaled by how long that surface is.
 */

export type UvShape = 'box' | 'plane' | 'ground' | 'disc' | 'sphere' | 'cylinder';

const round = (value: number) => Math.round(value * 1e5) / 1e5;

/**
 * The coordinates to give a mesh of this shape and scale. `positions`, `normals` and `uvs` are the mesh's own vertex data (in
 * the mesh's unit size); `scale` is how big the object is in the world, per axis. `size` is the metres one repeat covers.
 */
export function worldUvs(shape: UvShape, positions: ArrayLike<number>, normals: ArrayLike<number>, uvs: ArrayLike<number>, scale: readonly [number, number, number], size: number): Float32Array {
	const out = new Float32Array(uvs.length);
	const metres = size > 0 ? size : 1;
	const [sx, sy, sz] = scale.map(Math.abs) as [number, number, number];
	const around = Math.PI * Math.max(sx, sz);
	for (let i = 0, v = 0; i < out.length; i += 2, v += 3) {
		const nx = Math.abs(normals[v]);
		const ny = Math.abs(normals[v + 1]);
		const nz = Math.abs(normals[v + 2]);
		const x = positions[v] * sx;
		const y = positions[v + 1] * sy;
		const z = positions[v + 2] * sz;
		const flat = shape === 'box' || shape === 'plane' || shape === 'ground' || shape === 'disc' || (shape === 'cylinder' && ny > 0.9);
		if (flat) {
			// The two axes along the face the vertex is on: a face turned to X shows Z and Y, to Y shows X and Z, to Z shows X and Y.
			const [u, w] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
			out[i] = round(u / metres);
			out[i + 1] = round(w / metres);
		} else if (shape === 'cylinder') {
			out[i] = round((uvs[i] * around) / metres);
			out[i + 1] = round((uvs[i + 1] * sy) / metres);
		} else {
			out[i] = round((uvs[i] * around) / metres);
			out[i + 1] = round((uvs[i + 1] * around * 0.5) / metres);
		}
	}
	return out;
}
