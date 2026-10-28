import { Accel } from './accel.ts';
import { insideSolid, isSolidShape } from './primitives.ts';
import { insideVolume, sampleVolume } from './sample.ts';
import type { BakeLight, BakePrimitive, BakeScene, BakedVolume, V3, VolumeSpec } from './types.ts';
import { FACE_DIRECTIONS, slotIndex, voxelCount } from './types.ts';

export interface BakeOptions {
	/** Directions gathered at each voxel (48 by default). */
	samples?: number;
	/** Rounds of bounces: the first sees lights and sky, each one after it adds a bounce (2 by default). */
	passes?: number;
	/** How far a gathering ray looks for a surface, in metres (24). */
	maxDistance?: number;
	/** Rounds of smoothing between neighbouring free voxels (1). */
	blur?: number;
	/** Called as the work goes, with the fraction done. */
	progress?: (fraction: number) => void;
}

const NORMAL_BIAS = 0.02;

/** A repeatable stream of numbers. */
function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** `count` directions spread evenly over the sphere, turned by a rotation drawn from `next` so they do not line up with the axes. */
function sphereDirections(count: number, next: () => number): V3[] {
	const dirs: V3[] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	const [ax, ay, az] = [next() * Math.PI * 2, next() * Math.PI * 2, next() * Math.PI * 2];
	const [sx, cx, sy, cy, sz, cz] = [Math.sin(ax), Math.cos(ax), Math.sin(ay), Math.cos(ay), Math.sin(az), Math.cos(az)];
	const roll = next() * Math.PI * 2;
	for (let i = 0; i < count; i++) {
		const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), phi = golden * i + roll;
		let v: V3 = [Math.cos(phi) * r, y, Math.sin(phi) * r];
		v = [v[0], v[1] * cx - v[2] * sx, v[1] * sx + v[2] * cx];
		v = [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
		v = [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
		dirs.push(v);
	}
	return dirs;
}

/** How many differently turned sets of directions the voxels share out: neighbours do not gather along the same rays, so what is missed becomes grain instead of blotches. */
const DIRECTION_SETS = 24;

function skyRadiance(scene: BakeScene, w: V3): V3 {
	const { top, horizon, bottom, intensity } = scene.sky;
	const y = Math.max(-1, Math.min(1, w[1]));
	const to = y >= 0 ? top : bottom, k = Math.abs(y);
	return [(horizon[0] + (to[0] - horizon[0]) * k) * intensity, (horizon[1] + (to[1] - horizon[1]) * k) * intensity, (horizon[2] + (to[2] - horizon[2]) * k) * intensity];
}

/** How strongly a light reaches a point `dist` away along `toLight` (a unit vector from the point), without the cosine of the surface. */
function reach(light: BakeLight, dist: number, toLight: V3): number {
	if (dist >= light.range) return 0;
	let k = 1 - dist / light.range;
	if (light.kind === 'spot') {
		const cos = -(toLight[0] * light.direction[0] + toLight[1] * light.direction[1] + toLight[2] * light.direction[2]);
		if (cos < light.cosHalfAngle) return 0;
		k *= Math.max(0, Math.pow(cos, light.exponent));
	}
	return k;
}

/** The light that reaches a surface point with normal `n` straight from the lights, with shadows, in the renderer's units. */
function directAt(scene: BakeScene, accel: Accel, p: V3, n: V3, out: V3): V3 {
	out[0] = out[1] = out[2] = 0;
	const origin: V3 = [p[0] + n[0] * NORMAL_BIAS, p[1] + n[1] * NORMAL_BIAS, p[2] + n[2] * NORMAL_BIAS];
	for (const light of scene.lights) {
		const dx = light.position[0] - origin[0], dy = light.position[1] - origin[1], dz = light.position[2] - origin[2];
		const dist = Math.hypot(dx, dy, dz);
		if (dist >= light.range || dist < 1e-6) continue;
		const l: V3 = [dx / dist, dy / dist, dz / dist];
		const ndl = n[0] * l[0] + n[1] * l[1] + n[2] * l[2];
		if (ndl <= 0) continue;
		const k = reach(light, dist, l) * ndl;
		if (k <= 0 || accel.occluded(origin, l, dist - NORMAL_BIAS)) continue;
		out[0] += light.color[0] * k; out[1] += light.color[1] * k; out[2] += light.color[2] * k;
	}
	return out;
}

/** Everything a bake works out once and every slab of it then reads: the surfaces that matter, which voxels are solid, the directions gathered. */
export interface BakePlan {
	scene: BakeScene;
	spec: VolumeSpec;
	passes: number;
	blur: number;
	samples: number;
	maxDistance: number;
	accel: Accel;
	solid: Uint8Array;
	sets: V3[][];
	/** The numbers of floats a volume of this grid holds. */
	floats: number;
}

/** The settings of a bake that decide its result, as text: part of what a baked file depends on. */
export function bakeSettingsKey(options: BakeOptions = {}): string {
	return `samples=${options.samples ?? 48};passes=${Math.max(1, options.passes ?? 2)};maxDistance=${options.maxDistance ?? 24};blur=${options.blur ?? 1}`;
}

/**
 * Works out what a bake needs before any voxel is computed. Each voxel of a pass depends only on the scene and on the previous
 * pass, never on another voxel of its own pass, so the rows of a pass can be computed in any order, or on several threads, and the
 * volume is the same (see `parallel.ts`).
 */
export function planBake(scene: BakeScene, spec: VolumeSpec, options: BakeOptions = {}): BakePlan {
	const samples = options.samples ?? 48, passes = Math.max(1, options.passes ?? 2), maxDistance = options.maxDistance ?? 24, blur = options.blur ?? 1;
	const [nx, ny, nz] = spec.dims;
	const total = voxelCount(spec);
	const max: V3 = [spec.min[0] + nx * spec.voxel, spec.min[1] + ny * spec.voxel, spec.min[2] + nz * spec.voxel];

	// Only what can touch the volume matters: what is within a gathering ray's reach of it.
	const near = scene.primitives.filter((p) => p.opaque && p.min[0] < max[0] + maxDistance && p.max[0] > spec.min[0] - maxDistance && p.min[1] < max[1] + maxDistance && p.max[1] > spec.min[1] - maxDistance && p.min[2] < max[2] + maxDistance && p.max[2] > spec.min[2] - maxDistance);
	const accel = new Accel(near);

	// Which voxels are inside a solid.
	const solid = new Uint8Array(total);
	const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	for (const p of near.filter((q) => isSolidShape(q.shape))) {
		const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((p.min[k] - spec.min[k]) / spec.voxel)));
		const hi = [0, 1, 2].map((k) => Math.min(spec.dims[k] - 1, Math.floor((p.max[k] - spec.min[k]) / spec.voxel)));
		for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
			if (solid[at(x, y, z)]) continue;
			if (insideSolid(p, [spec.min[0] + (x + 0.5) * spec.voxel, spec.min[1] + (y + 0.5) * spec.voxel, spec.min[2] + (z + 0.5) * spec.voxel])) solid[at(x, y, z)] = 1;
		}
	}

	const seed = random(20240607);
	const sets = Array.from({ length: DIRECTION_SETS }, () => sphereDirections(samples, seed));
	return { scene, spec, passes, blur, samples, maxDistance, accel, solid, sets, floats: total * 6 * 3 };
}

/**
 * One pass over the rows `zFrom` to `zTo` (exclusive) of the volume: writes their voxels into `out`, reading the previous pass's
 * values from `previous` (null for the first pass). `out` and `previous` hold `plan.floats` numbers each.
 */
export function bakeRows(plan: BakePlan, previous: Float32Array | null, out: Float32Array, zFrom: number, zTo: number, onRow?: (z: number) => void): void {
	const { scene, spec, accel, solid, sets, samples, maxDistance } = plan;
	const [nx, ny] = spec.dims;
	const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	const before: BakedVolume | null = previous ? { spec, data: previous } : null;
	const weight = 4 / samples;
	const scratch: V3 = [0, 0, 0], shaded: V3 = [0, 0, 0];
	const cube = new Float64Array(18);
	for (let z = zFrom; z < zTo; z++) {
		for (let y = 0; y < ny; y++) {
			for (let x = 0; x < nx; x++) {
				if (solid[at(x, y, z)]) continue;
				cube.fill(0);
				const c: V3 = [spec.min[0] + (x + 0.5) * spec.voxel, spec.min[1] + (y + 0.5) * spec.voxel, spec.min[2] + (z + 0.5) * spec.voxel];
				// The lights themselves: a light seen from the voxel lights each face by the cosine of its angle to it.
				for (const light of scene.lights) {
					const dx = light.position[0] - c[0], dy = light.position[1] - c[1], dz = light.position[2] - c[2];
					const dist = Math.hypot(dx, dy, dz);
					if (dist >= light.range || dist < 1e-6) continue;
					const l: V3 = [dx / dist, dy / dist, dz / dist];
					const k = reach(light, dist, l);
					if (k <= 0 || accel.occluded(c, l, dist)) continue;
					for (let f = 0; f < 6; f++) {
						const cos = l[0] * FACE_DIRECTIONS[f][0] + l[1] * FACE_DIRECTIONS[f][1] + l[2] * FACE_DIRECTIONS[f][2];
						if (cos <= 0) continue;
						for (let ch = 0; ch < 3; ch++) cube[f * 3 + ch] += light.color[ch] * k * cos;
					}
				}
				// Everything else: what comes from every direction.
				const dirs = sets[((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0) % DIRECTION_SETS];
				for (const w of dirs) {
					let radiance: V3;
					const hit = accel.closest(c, w, maxDistance);
					if (!hit) radiance = skyRadiance(scene, w);
					else {
						const p = hit.primitive;
						const point: V3 = [c[0] + w[0] * hit.t, c[1] + w[1] * hit.t, c[2] + w[2] * hit.t];
						directAt(scene, accel, point, hit.normal, shaded);
						let lr = shaded[0], lg = shaded[1], lb = shaded[2];
						if (before) {
							const probe: V3 = [point[0] + hit.normal[0] * spec.voxel * 0.75, point[1] + hit.normal[1] * spec.voxel * 0.75, point[2] + hit.normal[2] * spec.voxel * 0.75];
							if (insideVolume(before, probe)) { sampleVolume(before, probe, hit.normal, scratch); lr += scratch[0]; lg += scratch[1]; lb += scratch[2]; }
						}
						radiance = [p.albedo[0] * lr + (p.emissive ? p.emissive[0] : 0), p.albedo[1] * lg + (p.emissive ? p.emissive[1] : 0), p.albedo[2] * lb + (p.emissive ? p.emissive[2] : 0)];
					}
					for (let f = 0; f < 6; f++) {
						const cos = w[0] * FACE_DIRECTIONS[f][0] + w[1] * FACE_DIRECTIONS[f][1] + w[2] * FACE_DIRECTIONS[f][2];
						if (cos <= 0) continue;
						const k = cos * weight;
						cube[f * 3] += radiance[0] * k; cube[f * 3 + 1] += radiance[1] * k; cube[f * 3 + 2] += radiance[2] * k;
					}
				}
				for (let f = 0; f < 6; f++) {
					const i = slotIndex(spec, f, x, y, z);
					out[i] = cube[f * 3]; out[i + 1] = cube[f * 3 + 1]; out[i + 2] = cube[f * 3 + 2];
				}
			}
		}
		onRow?.(z);
	}
}

/** Fills the voxels inside solids and smooths the rest, which is what a volume is once its last pass is in `data`. */
export function finishBake(plan: BakePlan, data: Float32Array): BakedVolume {
	const volume: BakedVolume = { spec: plan.spec, data };
	fillSolid(volume, plan.solid);
	for (let round = 0; round < plan.blur; round++) smooth(volume, plan.solid);
	return volume;
}

/**
 * Bakes the light of a scene into a volume of ambient cubes. At each free voxel it adds what the lights give directly (with
 * shadows) to what comes from every direction: a ray that leaves the scene brings the sky, one that meets a surface brings what
 * that surface sends back, which is its colour times the light on it (and, from the second round on, times the light the volume
 * already holds there, which is how bounces build up). A voxel inside a wall takes its neighbours' values, so that sampling
 * next to a wall does not pull in black.
 */
export function bake(scene: BakeScene, spec: VolumeSpec, options: BakeOptions = {}): BakedVolume {
	return bakeDetailed(scene, spec, options).volume;
}

/** `bake`, with the plan it worked from, which the quality checks (`qa.ts`) read. */
export function bakeDetailed(scene: BakeScene, spec: VolumeSpec, options: BakeOptions = {}): { volume: BakedVolume; plan: BakePlan } {
	const plan = planBake(scene, spec, options);
	let previous: Float32Array | null = null;
	for (let pass = 0; pass < plan.passes; pass++) {
		const out: Float32Array = new Float32Array(plan.floats);
		bakeRows(plan, previous, out, 0, spec.dims[2], (z) => options.progress?.((pass + (z + 1) / spec.dims[2]) / plan.passes));
		previous = out;
	}
	return { volume: finishBake(plan, previous as Float32Array), plan };
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Voxels inside solids take the average of the filled voxels beside them, working inwards, so a thin wall has no black core. */
function fillSolid(volume: BakedVolume, solid: Uint8Array): void {
	const { spec, data } = volume;
	const [nx, ny, nz] = spec.dims;
	const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	const filled = new Uint8Array(solid.length);
	for (let i = 0; i < solid.length; i++) filled[i] = solid[i] ? 0 : 1;
	for (let round = 0; round < 8; round++) {
		const pending: number[][] = [];
		for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
			if (filled[at(x, y, z)]) continue;
			let count = 0;
			const sum = new Float64Array(18);
			for (const [dx, dy, dz] of NEIGHBOURS) {
				const px = x + dx, py = y + dy, pz = z + dz;
				if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz || !filled[at(px, py, pz)]) continue;
				count++;
				for (let f = 0; f < 6; f++) { const i = slotIndex(spec, f, px, py, pz); for (let ch = 0; ch < 3; ch++) sum[f * 3 + ch] += data[i + ch]; }
			}
			if (count) pending.push([x, y, z, ...Array.from(sum, (v) => v / count)]);
		}
		if (!pending.length) break;
		for (const entry of pending) {
			const [x, y, z] = entry;
			for (let f = 0; f < 6; f++) { const i = slotIndex(spec, f, x, y, z); for (let ch = 0; ch < 3; ch++) data[i + ch] = entry[3 + f * 3 + ch]; }
			filled[at(x, y, z)] = 1;
		}
	}
}

/** A little smoothing between neighbouring free voxels, which takes the grain of the sampling off. */
function smooth(volume: BakedVolume, solid: Uint8Array): void {
	const { spec, data } = volume;
	const [nx, ny, nz] = spec.dims;
	const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
	const out = new Float32Array(data.length);
	for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
		const free = !solid[at(x, y, z)];
		for (let f = 0; f < 6; f++) {
			const i = slotIndex(spec, f, x, y, z);
			if (!free) { for (let ch = 0; ch < 3; ch++) out[i + ch] = data[i + ch]; continue; }
			for (let ch = 0; ch < 3; ch++) {
				let sum = data[i + ch] * 2, weight = 2;
				for (const [dx, dy, dz] of NEIGHBOURS) {
					const px = x + dx, py = y + dy, pz = z + dz;
					if (px < 0 || py < 0 || pz < 0 || px >= nx || py >= ny || pz >= nz || solid[at(px, py, pz)]) continue;
					sum += data[slotIndex(spec, f, px, py, pz) + ch]; weight += 1;
				}
				out[i + ch] = sum / weight;
			}
		}
	}
	data.set(out);
}

/** The spec of a grid that covers a box, with `voxel`-sized cells. */
export function specFor(min: V3, max: V3, voxel: number): VolumeSpec {
	return { min: [...min], voxel, dims: [Math.max(1, Math.ceil((max[0] - min[0]) / voxel)), Math.max(1, Math.ceil((max[1] - min[1]) / voxel)), Math.max(1, Math.ceil((max[2] - min[2]) / voxel))] };
}

export type { BakePrimitive };
