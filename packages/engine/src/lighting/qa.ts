import type { BakePlan } from './bake.ts';
import type { BakedVolume, V3 } from './types.ts';
import { slotIndex } from './types.ts';

/** How good a baked volume looks, in numbers a script can check and print. */
export interface VolumeQuality {
	voxels: number;
	/** Voxels that are not inside a solid. */
	free: number;
	/** Brightness over the free voxels (relative luminance of the light a voxel receives). */
	luminance: { mean: number; p5: number; p50: number; p95: number; max: number };
	/** How much a voxel differs from the average of its free neighbours, relative to the mean: 0 for a smooth volume, high for a grainy one. */
	noise: number;
	/** Fraction of free voxels that receive almost no light. */
	dark: number;
	/** Free voxels whose cell is cut by a solid although their centre is not: where thin walls let light through. */
	straddling: number;
	/** What is worth looking at, in words. */
	warnings: string[];
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** The light a voxel receives as one number: the mean of its six faces, weighed by the eye's sensitivity to each colour. */
export function voxelLuminance(volume: BakedVolume, x: number, y: number, z: number): number {
	let sum = 0;
	for (let f = 0; f < 6; f++) {
		const i = slotIndex(volume.spec, f, x, y, z);
		sum += 0.2126 * volume.data[i] + 0.7152 * volume.data[i + 1] + 0.0722 * volume.data[i + 2];
	}
	return sum / 6;
}

/** Whether the cube of half side `half` around `c` touches the unit box that the matrix `m` (row-vector, as in `matrix.ts`) puts in the world: the separating-axis test. */
function cellTouchesBox(m: ArrayLike<number>, c: V3, half: number): boolean {
	const axes: V3[] = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
	const lengths = axes.map((a) => Math.hypot(a[0], a[1], a[2]));
	const units = axes.map((a, i) => (lengths[i] > 1e-12 ? [a[0] / lengths[i], a[1] / lengths[i], a[2] / lengths[i]] as V3 : [0, 0, 0] as V3));
	const d: V3 = [m[12] - c[0], m[13] - c[1], m[14] - c[2]];
	const world: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
	const tests: V3[] = [...world, ...units];
	for (const u of units) for (const w of world) tests.push([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
	for (const l of tests) {
		const n = Math.hypot(l[0], l[1], l[2]);
		if (n < 1e-9) continue;
		const axis: V3 = [l[0] / n, l[1] / n, l[2] / n];
		const dot = (a: V3) => a[0] * axis[0] + a[1] * axis[1] + a[2] * axis[2];
		const rCell = half * (Math.abs(axis[0]) + Math.abs(axis[1]) + Math.abs(axis[2]));
		const rBox = units.reduce((sum, u, i) => sum + (lengths[i] / 2) * Math.abs(dot(u)), 0);
		if (Math.abs(dot(d)) > rCell + rBox) return false;
	}
	return true;
}

/** Measures a baked volume (with the plan it was baked from: it knows the solids and the surfaces). */
export function analyzeVolume(volume: BakedVolume, plan: Pick<BakePlan, 'solid' | 'scene'>): VolumeQuality {
	const { spec } = volume;
	const [nx, ny, nz] = spec.dims;
	const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	const lum = new Float32Array(nx * ny * nz);
	const free: number[] = [];
	for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
		const i = at(x, y, z);
		if (plan.solid[i]) continue;
		lum[i] = voxelLuminance(volume, x, y, z);
		free.push(lum[i]);
	}
	const sorted = Float32Array.from(free).sort();
	const pick = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
	const mean = free.length ? free.reduce((a, b) => a + b, 0) / free.length : 0;
	const luminance = { mean, p5: pick(0.05), p50: pick(0.5), p95: pick(0.95), max: sorted.length ? sorted[sorted.length - 1] : 0 };

	let squares = 0, counted = 0, dark = 0;
	const darkLevel = Math.max(1e-4, luminance.p95 * 0.02);
	for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
		const i = at(x, y, z);
		if (plan.solid[i]) continue;
		if (lum[i] < darkLevel) dark++;
		let sum = 0, n = 0;
		for (const [dx, dy, dz] of NEIGHBOURS) {
			const px = x + dx, py = y + dy, pz = z + dz;
			if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz || plan.solid[at(px, py, pz)]) continue;
			sum += lum[at(px, py, pz)]; n++;
		}
		if (!n) continue;
		const d = lum[i] - sum / n;
		squares += d * d; counted++;
	}
	const noise = counted && mean > 1e-6 ? Math.sqrt(squares / counted) / mean : 0;

	// A solid thinner than a cell passes through cells whose centres count as free, and light leaks along it: count those cells.
	const thin = plan.scene.primitives.filter((p) => p.opaque && p.shape === 'box' && Math.min(Math.hypot(p.world[0], p.world[1], p.world[2]), Math.hypot(p.world[4], p.world[5], p.world[6]), Math.hypot(p.world[8], p.world[9], p.world[10])) < spec.voxel);
	let straddling = 0;
	if (thin.length) {
		const half = spec.voxel / 2;
		for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
			if (plan.solid[at(x, y, z)]) continue;
			const c: V3 = [spec.min[0] + (x + 0.5) * spec.voxel, spec.min[1] + (y + 0.5) * spec.voxel, spec.min[2] + (z + 0.5) * spec.voxel];
			if (thin.some((p) => cellTouchesBox(p.world, c, half))) straddling++;
		}
	}

	const darkFraction = free.length ? dark / free.length : 0;
	const straddleFraction = free.length ? straddling / free.length : 0;
	const warnings: string[] = [];
	if (free.length === 0) warnings.push('The volume is entirely inside solids: nothing was baked.');
	if (noise > 0.12) warnings.push(`Grainy: neighbouring voxels differ by ${(noise * 100).toFixed(0)}% of the mean. Raise the samples or the blur.`);
	if (darkFraction > 0.3) warnings.push(`${(darkFraction * 100).toFixed(0)}% of the free voxels receive almost no light. Is a light missing or inside a solid?`);
	if (straddleFraction > 0.04) warnings.push(`${straddling} voxels (${(straddleFraction * 100).toFixed(1)}%) are cut by a thin wall: light can leak through. Use a smaller voxel or thicker walls.`);
	return { voxels: nx * ny * nz, free: free.length, luminance, noise, dark: darkFraction, straddling, warnings };
}

/** A picture of a volume: the horizontal slice at height index `y` and the vertical slice at depth index `z`, side by side, as RGBA. Solids are blue-grey. */
export function sliceImage(volume: BakedVolume, plan: Pick<BakePlan, 'solid'>, options: { y?: number; z?: number; scale?: number } = {}): { width: number; height: number; rgba: Uint8Array } {
	const { spec } = volume;
	const [nx, ny, nz] = spec.dims;
	const y = Math.min(ny - 1, Math.max(0, options.y ?? Math.floor(ny / 2)));
	const z = Math.min(nz - 1, Math.max(0, options.z ?? Math.floor(nz / 2)));
	const scale = Math.max(1, Math.round(options.scale ?? Math.max(1, 320 / Math.max(nx, ny, nz))));
	const gap = 4;
	const width = (nx + nx) * scale + gap, height = Math.max(nz, ny) * scale;
	const rgba = new Uint8Array(width * height * 4).fill(0);
	for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
	const at = (x: number, yy: number, zz: number) => (zz * ny + yy) * nx + x;
	// Exposure from the bright end of the volume, so a dim map and a bright one both read.
	const values: number[] = [];
	for (let i = 0; i < plan.solid.length; i++) if (!plan.solid[i]) values.push(i);
	const lums = values.map((i) => { const zz = Math.floor(i / (nx * ny)), yy = Math.floor((i % (nx * ny)) / nx), xx = i % nx; return voxelLuminance(volume, xx, yy, zz); }).sort((a, b) => a - b);
	const white = Math.max(1e-4, lums.length ? lums[Math.floor(lums.length * 0.97)] : 1);
	const put = (px: number, py: number, rgb: [number, number, number]) => {
		for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
			const o = (((py * scale + dy) * width) + px * scale + dx) * 4;
			rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2];
		}
	};
	const colour = (x: number, yy: number, zz: number): [number, number, number] => {
		if (plan.solid[at(x, yy, zz)]) return [58, 66, 96];
		let r = 0, g = 0, b = 0;
		for (let f = 0; f < 6; f++) { const i = slotIndex(spec, f, x, yy, zz); r += volume.data[i]; g += volume.data[i + 1]; b += volume.data[i + 2]; }
		const map = (v: number) => Math.round(255 * Math.pow(Math.min(1, v / 6 / white), 1 / 2.2));
		return [map(r), map(g), map(b)];
	};
	// Left: looking down at the slice at height y (x across, z up the picture). Right: looking along z at the slice at depth z (x across, y up).
	for (let zz = 0; zz < nz; zz++) for (let x = 0; x < nx; x++) put(x, nz - 1 - zz, colour(x, y, zz));
	const offset = nx + Math.ceil(gap / scale);
	for (let yy = 0; yy < ny; yy++) for (let x = 0; x < nx; x++) put(offset + x, ny - 1 - yy, colour(x, yy, z));
	return { width, height, rgba };
}
