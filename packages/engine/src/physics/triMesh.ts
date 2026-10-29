import type { V3 } from './shapes.ts';

/**
 * A solid made of triangles (a room, a cave, a prop with a hollow in it), in world space, with a grid over it so a question only
 * looks at the triangles near the place it is about. It is made once and thrown away when the thing it was made from moves.
 * Triangles are two-sided: a body is pushed away from the side of a wall it is on.
 */
export interface TriMesh {
	kind: 'mesh';
	/** x, y, z of every vertex. */
	positions: Float32Array;
	/** Three vertex numbers per triangle. */
	indices: Uint32Array;
	min: V3;
	max: V3;
	cell: number;
	dims: V3;
	/** The triangles in cell `c` are `cellTris[cellStart[c]..cellStart[c + 1]]`. */
	cellStart: Uint32Array;
	cellTris: Uint32Array;
	/** Which triangles the question in progress has already looked at. */
	stamp: Uint32Array;
	stampId: number;
}

const MAX_CELLS = 2_000_000;

export function buildTriMesh(positions: Float32Array, indices: ArrayLike<number>): TriMesh {
	const tris = Math.floor(indices.length / 3);
	const index = new Uint32Array(tris * 3);
	for (let i = 0; i < tris * 3; i++) index[i] = indices[i];
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < index.length; i++) {
		for (let k = 0; k < 3; k++) {
			const v = positions[index[i] * 3 + k];
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	}
	if (tris === 0) { min.fill(0); max.fill(0); }
	const extent: V3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
	let cell = Math.max(0.25, Math.max(extent[0], extent[1], extent[2]) / 48);
	const dimsFor = (c: number): V3 => [Math.floor(extent[0] / c) + 1, Math.floor(extent[1] / c) + 1, Math.floor(extent[2] / c) + 1];
	let dims = dimsFor(cell);
	while (dims[0] * dims[1] * dims[2] > MAX_CELLS) { cell *= 1.5; dims = dimsFor(cell); }

	const mesh: TriMesh = { kind: 'mesh', positions, indices: index, min, max, cell, dims, cellStart: new Uint32Array(dims[0] * dims[1] * dims[2] + 1), cellTris: new Uint32Array(0), stamp: new Uint32Array(tris), stampId: 0 };
	const range = (t: number): [number, number, number, number, number, number] => {
		const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
		for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
			const v = positions[index[t * 3 + c] * 3 + k];
			if (v < lo[k]) lo[k] = v;
			if (v > hi[k]) hi[k] = v;
		}
		const at = (v: number, k: number) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - min[k]) / cell)));
		return [at(lo[0], 0), at(lo[1], 1), at(lo[2], 2), at(hi[0], 0), at(hi[1], 1), at(hi[2], 2)];
	};
	// Two passes: how many triangles each cell holds, then where they go.
	const counts = new Uint32Array(dims[0] * dims[1] * dims[2]);
	for (let t = 0; t < tris; t++) {
		const [x0, y0, z0, x1, y1, z1] = range(t);
		for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) counts[x + dims[0] * (y + dims[1] * z)]++;
	}
	for (let c = 0; c < counts.length; c++) mesh.cellStart[c + 1] = mesh.cellStart[c] + counts[c];
	mesh.cellTris = new Uint32Array(mesh.cellStart[counts.length]);
	const fill = mesh.cellStart.slice(0, counts.length);
	for (let t = 0; t < tris; t++) {
		const [x0, y0, z0, x1, y1, z1] = range(t);
		for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mesh.cellTris[fill[x + dims[0] * (y + dims[1] * z)]++] = t;
	}
	return mesh;
}

const vertex = (m: TriMesh, t: number, c: number, out: V3): V3 => {
	const i = m.indices[t * 3 + c] * 3;
	out[0] = m.positions[i]; out[1] = m.positions[i + 1]; out[2] = m.positions[i + 2];
	return out;
};

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The unit normal of a triangle (zero for one with no area). */
function faceNormal(a: V3, b: V3, c: V3): V3 {
	const n = cross(sub(b, a), sub(c, a));
	const l = Math.hypot(n[0], n[1], n[2]);
	return l > 1e-12 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 1, 0];
}

/** The point of the triangle `abc` nearest to `p`. */
function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
	const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
	const d1 = dot(ab, ap), d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) return a;
	const bp = sub(p, b);
	const d3 = dot(ab, bp), d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) return b;
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
	const cp = sub(p, c);
	const d5 = dot(ab, cp), d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) return c;
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
	const denom = 1 / (va + vb + vc);
	const v = vb * denom, w = vc * denom;
	return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export interface MeshNearest {
	distance: number;
	point: V3;
	normal: V3;
}

/** The nearest point of the mesh within `reach` of `p`, and the way out on the side `p` is on; null when nothing is that near. */
export function nearestOnMesh(m: TriMesh, p: V3, reach: number): MeshNearest | null {
	const lo = [0, 1, 2].map((k) => Math.max(0, Math.floor((p[k] - reach - m.min[k]) / m.cell)));
	const hi = [0, 1, 2].map((k) => Math.min(m.dims[k] - 1, Math.floor((p[k] + reach - m.min[k]) / m.cell)));
	if (lo.some((v, k) => v > hi[k])) return null;
	const id = ++m.stampId;
	let bestD2 = reach * reach, bestTri = -1, bestPoint: V3 = p;
	const a: V3 = [0, 0, 0], b: V3 = [0, 0, 0], c: V3 = [0, 0, 0];
	for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
		const cellIndex = x + m.dims[0] * (y + m.dims[1] * z);
		for (let i = m.cellStart[cellIndex]; i < m.cellStart[cellIndex + 1]; i++) {
			const t = m.cellTris[i];
			if (m.stamp[t] === id) continue;
			m.stamp[t] = id;
			const q = closestOnTriangle(p, vertex(m, t, 0, a), vertex(m, t, 1, b), vertex(m, t, 2, c));
			const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
			if (d2 < bestD2) { bestD2 = d2; bestTri = t; bestPoint = q; }
		}
	}
	if (bestTri < 0) return null;
	const n = faceNormal(vertex(m, bestTri, 0, a), vertex(m, bestTri, 1, b), vertex(m, bestTri, 2, c));
	const distance = Math.sqrt(bestD2);
	if (distance > 1e-6) return { distance, point: bestPoint, normal: [(p[0] - bestPoint[0]) / distance, (p[1] - bestPoint[1]) / distance, (p[2] - bestPoint[2]) / distance] };
	return { distance: 0, point: bestPoint, normal: n };
}

export interface MeshRayHit {
	t: number;
	normal: V3;
}

/** Where a ray (a unit `direction`) first meets a triangle of the mesh within `maxT`; the normal faces the ray. */
export function rayMesh(m: TriMesh, origin: V3, direction: V3, maxT: number): MeshRayHit | null {
	// The part of the ray inside the grid's box.
	let t0 = 0, t1 = maxT;
	for (let k = 0; k < 3; k++) {
		const lo = m.min[k] - 1e-4, hi = m.max[k] + 1e-4;
		if (Math.abs(direction[k]) < 1e-12) {
			if (origin[k] < lo || origin[k] > hi) return null;
			continue;
		}
		let near = (lo - origin[k]) / direction[k], far = (hi - origin[k]) / direction[k];
		if (near > far) { const s = near; near = far; far = s; }
		t0 = Math.max(t0, near);
		t1 = Math.min(t1, far);
		if (t0 > t1) return null;
	}
	const start: V3 = [origin[0] + direction[0] * t0, origin[1] + direction[1] * t0, origin[2] + direction[2] * t0];
	const at: V3 = [0, 0, 0], step: V3 = [0, 0, 0], tMax: V3 = [0, 0, 0], tDelta: V3 = [0, 0, 0];
	for (let k = 0; k < 3; k++) {
		at[k] = Math.min(m.dims[k] - 1, Math.max(0, Math.floor((start[k] - m.min[k]) / m.cell)));
		if (Math.abs(direction[k]) < 1e-12) { step[k] = 0; tMax[k] = Infinity; tDelta[k] = Infinity; continue; }
		step[k] = direction[k] > 0 ? 1 : -1;
		tMax[k] = (m.min[k] + (at[k] + (step[k] > 0 ? 1 : 0)) * m.cell - origin[k]) / direction[k];
		tDelta[k] = m.cell / Math.abs(direction[k]);
	}
	const id = ++m.stampId;
	let best = Infinity, bestTri = -1;
	const a: V3 = [0, 0, 0], b: V3 = [0, 0, 0], c: V3 = [0, 0, 0];
	for (;;) {
		const cellIndex = at[0] + m.dims[0] * (at[1] + m.dims[1] * at[2]);
		for (let i = m.cellStart[cellIndex]; i < m.cellStart[cellIndex + 1]; i++) {
			const t = m.cellTris[i];
			if (m.stamp[t] === id) continue;
			m.stamp[t] = id;
			const hit = rayTriangle(origin, direction, vertex(m, t, 0, a), vertex(m, t, 1, b), vertex(m, t, 2, c));
			if (hit !== null && hit <= t1 + 1e-6 && hit < best) { best = hit; bestTri = t; }
		}
		const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
		if (best <= tMax[k] || tMax[k] > t1) break;
		at[k] += step[k];
		if (at[k] < 0 || at[k] >= m.dims[k]) break;
		tMax[k] += tDelta[k];
	}
	if (bestTri < 0 || best > maxT) return null;
	const n = faceNormal(vertex(m, bestTri, 0, a), vertex(m, bestTri, 1, b), vertex(m, bestTri, 2, c));
	return { t: best, normal: dot(n, direction) > 0 ? [-n[0], -n[1], -n[2]] : n };
}

/** The distance along the ray at which it crosses the triangle, either side of it; null when it does not. */
function rayTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): number | null {
	const e1 = sub(b, a), e2 = sub(c, a);
	const h = cross(d, e2);
	const det = dot(e1, h);
	if (Math.abs(det) < 1e-12) return null;
	const f = 1 / det;
	const s = sub(o, a);
	const u = f * dot(s, h);
	if (u < 0 || u > 1) return null;
	const q = cross(s, e1);
	const v = f * dot(d, q);
	if (v < 0 || u + v > 1) return null;
	const t = f * dot(e2, q);
	return t >= 0 ? t : null;
}
