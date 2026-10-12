import type { BakedVolume, V3 } from './types.ts';
import { slotIndex } from './types.ts';

/**
 * The light a surface with normal `n` at `p` receives from a baked volume: the colours of the three faces it leans towards,
 * blended by the square of each component of the normal (an ambient cube), each read with trilinear filtering between voxel
 * centres. This is the arithmetic the shader does; the baker uses it to count bounces.
 */
export function sampleVolume(volume: BakedVolume, p: V3, n: V3, out: V3 = [0, 0, 0]): V3 {
	const { spec, data } = volume;
	const [nx, ny, nz] = spec.dims;
	const u = clamp((p[0] - spec.min[0]) / spec.voxel - 0.5, 0, nx - 1), v = clamp((p[1] - spec.min[1]) / spec.voxel - 0.5, 0, ny - 1), w = clamp((p[2] - spec.min[2]) / spec.voxel - 0.5, 0, nz - 1);
	const x0 = Math.floor(u), y0 = Math.floor(v), z0 = Math.floor(w);
	const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1), z1 = Math.min(nz - 1, z0 + 1);
	const fx = u - x0, fy = v - y0, fz = w - z0;
	out[0] = out[1] = out[2] = 0;
	const faces = [n[0] >= 0 ? 0 : 1, n[1] >= 0 ? 2 : 3, n[2] >= 0 ? 4 : 5];
	for (let a = 0; a < 3; a++) {
		const weight = n[a] * n[a];
		if (weight < 1e-6) continue;
		const face = faces[a];
		for (let c = 0; c < 3; c++) {
			const at = (x: number, y: number, z: number) => data[slotIndex(spec, face, x, y, z) + c];
			const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx, c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
			const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx, c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
			out[c] += weight * ((c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz);
		}
	}
	return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Whether a point is inside the volume's bounds. */
export function insideVolume(volume: BakedVolume, p: V3): boolean {
	const { spec } = volume;
	for (let k = 0; k < 3; k++) if (p[k] < spec.min[k] || p[k] > spec.min[k] + spec.dims[k] * spec.voxel) return false;
	return true;
}
