import { T_EPS, intersect } from './primitives.ts';
import type { BakePrimitive, V3 } from './types.ts';

export interface ClosestHit {
	t: number;
	normal: V3;
	primitive: BakePrimitive;
}

/**
 * A uniform grid over the surfaces that block light, walked by a ray cell by cell (Amanatides and Woo). Each surface is listed
 * in every cell its bounds touch; a ray that meets the same surface in two cells tests it once.
 */
export class Accel {
	private readonly min: V3;
	private readonly size: V3;
	private readonly cell: number;
	private readonly dims: [number, number, number];
	private readonly start: Int32Array;
	private readonly items: Int32Array;
	private readonly seen: Int32Array;
	private stamp = 0;

	constructor(private readonly primitives: BakePrimitive[], cell = 2) {
		const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
		for (const p of primitives) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.min[k]); hi[k] = Math.max(hi[k], p.max[k]); }
		if (!primitives.length) { lo.fill(0); hi.fill(1); }
		// Keep the grid to a size that fits in memory however big the scene is.
		let side = cell;
		while (Math.ceil((hi[0] - lo[0]) / side) * Math.ceil((hi[1] - lo[1]) / side) * Math.ceil((hi[2] - lo[2]) / side) > 2_000_000) side *= 1.5;
		this.cell = side;
		this.min = lo;
		this.size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
		this.dims = [Math.max(1, Math.ceil(this.size[0] / side)), Math.max(1, Math.ceil(this.size[1] / side)), Math.max(1, Math.ceil(this.size[2] / side))];
		const cells = this.dims[0] * this.dims[1] * this.dims[2];
		const counts = new Int32Array(cells + 1);
		const range = (p: BakePrimitive): [number, number, number, number, number, number] => [
			Math.max(0, Math.floor((p.min[0] - lo[0]) / side)), Math.min(this.dims[0] - 1, Math.floor((p.max[0] - lo[0]) / side)),
			Math.max(0, Math.floor((p.min[1] - lo[1]) / side)), Math.min(this.dims[1] - 1, Math.floor((p.max[1] - lo[1]) / side)),
			Math.max(0, Math.floor((p.min[2] - lo[2]) / side)), Math.min(this.dims[2] - 1, Math.floor((p.max[2] - lo[2]) / side))
		];
		for (const p of primitives) {
			const [x0, x1, y0, y1, z0, z1] = range(p);
			for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[(z * this.dims[1] + y) * this.dims[0] + x + 1]++;
		}
		for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
		this.start = counts;
		this.items = new Int32Array(counts[cells]);
		const fill = counts.slice(0, cells);
		primitives.forEach((p, index) => {
			const [x0, x1, y0, y1, z0, z1] = range(p);
			for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.items[fill[(z * this.dims[1] + y) * this.dims[0] + x]++] = index;
		});
		this.seen = new Int32Array(primitives.length);
	}

	/** The nearest surface along the unit ray `o` + t `d`, up to `tMax`. */
	closest(o: V3, d: V3, tMax: number): ClosestHit | null {
		let best: ClosestHit | null = null;
		this.walk(o, d, tMax, (index, limit) => {
			const p = this.primitives[index];
			const hit = intersect(p, o, d, best ? best.t : limit);
			if (hit && (!best || hit.t < best.t)) best = { t: hit.t, normal: hit.normal, primitive: p };
			return best ? best.t : limit;
		});
		return best;
	}

	/** Whether anything stands between `o` and the point `tMax` away along the unit ray. */
	occluded(o: V3, d: V3, tMax: number): boolean {
		let blocked = false;
		this.walk(o, d, tMax, (index, limit) => {
			if (intersect(this.primitives[index], o, d, limit)) { blocked = true; return -1; }
			return limit;
		});
		return blocked;
	}

	/** Visits the surfaces listed in the cells the ray crosses, nearest cells first; `visit` returns the new far limit, or a negative number to stop. */
	private walk(o: V3, d: V3, tMax: number, visit: (primitive: number, limit: number) => number): void {
		const [nx, ny, nz] = this.dims;
		// Clip the ray to the grid.
		let t0 = 0, t1 = tMax;
		for (let k = 0; k < 3; k++) {
			const lo = this.min[k], hi = this.min[k] + this.dims[k] * this.cell;
			if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo || o[k] > hi) return; continue; }
			let a = (lo - o[k]) / d[k], b = (hi - o[k]) / d[k];
			if (a > b) [a, b] = [b, a];
			t0 = Math.max(t0, a); t1 = Math.min(t1, b);
			if (t0 > t1) return;
		}
		const px = o[0] + d[0] * (t0 + 1e-9), py = o[1] + d[1] * (t0 + 1e-9), pz = o[2] + d[2] * (t0 + 1e-9);
		let ix = Math.min(nx - 1, Math.max(0, Math.floor((px - this.min[0]) / this.cell)));
		let iy = Math.min(ny - 1, Math.max(0, Math.floor((py - this.min[1]) / this.cell)));
		let iz = Math.min(nz - 1, Math.max(0, Math.floor((pz - this.min[2]) / this.cell)));
		const stepX = d[0] > 0 ? 1 : -1, stepY = d[1] > 0 ? 1 : -1, stepZ = d[2] > 0 ? 1 : -1;
		const next = (i: number, k: number, step: number) => this.min[k] + (step > 0 ? i + 1 : i) * this.cell;
		let tx = Math.abs(d[0]) < 1e-12 ? Infinity : (next(ix, 0, stepX) - o[0]) / d[0];
		let ty = Math.abs(d[1]) < 1e-12 ? Infinity : (next(iy, 1, stepY) - o[1]) / d[1];
		let tz = Math.abs(d[2]) < 1e-12 ? Infinity : (next(iz, 2, stepZ) - o[2]) / d[2];
		const dx = Math.abs(d[0]) < 1e-12 ? Infinity : this.cell / Math.abs(d[0]);
		const dy = Math.abs(d[1]) < 1e-12 ? Infinity : this.cell / Math.abs(d[1]);
		const dz = Math.abs(d[2]) < 1e-12 ? Infinity : this.cell / Math.abs(d[2]);
		const stamp = ++this.stamp;
		let limit = t1;
		for (;;) {
			const cellIndex = (iz * ny + iy) * nx + ix;
			for (let k = this.start[cellIndex]; k < this.start[cellIndex + 1]; k++) {
				const id = this.items[k];
				if (this.seen[id] === stamp) continue;
				this.seen[id] = stamp;
				limit = visit(id, limit);
				if (limit < 0) return;
			}
			// A hit found in this cell cannot be beaten by what is in cells further along.
			const tNext = Math.min(tx, ty, tz);
			if (tNext > limit + T_EPS) return;
			if (tx <= ty && tx <= tz) { ix += stepX; tx += dx; if (ix < 0 || ix >= nx) return; }
			else if (ty <= tz) { iy += stepY; ty += dy; if (iy < 0 || iy >= ny) return; }
			else { iz += stepZ; tz += dz; if (iz < 0 || iz >= nz) return; }
		}
	}
}
