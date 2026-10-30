/**
 * Geometry of a box whose edges can be rounded, each one on its own. Pure arrays in and out, so it is tested in Node.
 *
 * The box is a cube of size `dims` (metres) built face by face on a grid that is dense near the edges. Each vertex that lies in
 * the rounded band of an edge is moved onto that edge's quarter circle; the rest stay on the flat faces. Where two rounded edges
 * meet at a corner their rounds are mitred (the one that cuts deeper wins); where all three do, the corner is a sphere octant.
 * A corner where only some of its edges are rounded (two rounds meeting a sharp edge) is an approximation: it stays closed, but a few of its tiny triangles can fold over.
 *
 * The vertex count depends only on `segments`, never on the radius or the edges, so the data of a live mesh can be rewritten in place.
 */

/** The twelve edges: four round the top, four round the bottom and four standing up. Left is -X, front is -Z. */
export const BOX_EDGES = [
	'top-front', 'top-back', 'top-left', 'top-right',
	'bottom-front', 'bottom-back', 'bottom-left', 'bottom-right',
	'front-left', 'front-right', 'back-left', 'back-right'
] as const;
export type BoxEdge = (typeof BOX_EDGES)[number];

export const DEFAULT_ROUND_SEGMENTS = 5;

export interface RoundedBoxData {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
}

const word = (axis: number, sign: number) => (axis === 0 ? (sign < 0 ? 'left' : 'right') : axis === 1 ? (sign < 0 ? 'bottom' : 'top') : sign < 0 ? 'front' : 'back');

/** The name of the edge that runs along `axis` at the given signs of the two other axes (given in ascending axis order). */
function edgeName(axis: number, signs: readonly [number, number, number]): string {
	const others = [0, 1, 2].filter((a) => a !== axis);
	// Vertical words first (top, bottom), then front/back, then left/right.
	const order = (a: number) => (a === 1 ? 0 : a === 2 ? 1 : 2);
	return others.sort((a, b) => order(a) - order(b)).map((a) => word(a, signs[a])).join('-');
}

/** Which edges are rounded: all of them when `edges` is not given. */
export function roundedEdgeSet(edges?: readonly string[]): ReadonlySet<string> {
	return new Set(edges ?? BOX_EDGES);
}

/** Per face: the axis of its normal and its sign, and which position axis (with sign) gives u and v, as Babylon's own box does, so textures lie the same way. */
const FACES: { k: number; s: number; u: [number, number]; v: [number, number] }[] = [
	{ k: 2, s: 1, u: [0, 1], v: [1, -1] },
	{ k: 2, s: -1, u: [0, 1], v: [1, 1] },
	{ k: 0, s: 1, u: [1, 1], v: [2, -1] },
	{ k: 0, s: -1, u: [1, 1], v: [2, 1] },
	{ k: 1, s: 1, u: [2, 1], v: [0, -1] },
	{ k: 1, s: -1, u: [2, 1], v: [0, 1] }
];

/** The grid of one axis, ascending: dense in the band of `radius` at each end, so a quarter circle has `segments` steps. */
function axisCoords(half: number, radius: number, segments: number): number[] {
	const inner = half - radius;
	const side: number[] = [];
	for (let k = 0; k <= segments; k++) side.push(inner + radius * Math.tan((k / segments) * (Math.PI / 4)));
	return [...side.map((v) => -v).reverse(), ...side];
}

export function roundedBox(dims: readonly [number, number, number], radius: number, edges?: readonly string[], segments = DEFAULT_ROUND_SEGMENTS): RoundedBoxData {
	const half = dims.map((d) => Math.max(Math.abs(d), 1e-4) / 2) as [number, number, number];
	const r = Math.max(0, Math.min(radius, half[0], half[1], half[2]));
	const selected = roundedEdgeSet(edges);
	const coords = half.map((h) => axisCoords(h, r, segments));
	const inner = half.map((h) => h - r);
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];

	/** Moves a point of the box surface onto the rounded shape. */
	const round = (p: [number, number, number], face: number): { p: [number, number, number]; n: [number, number, number] | null } => {
		if (r <= 0) return { p, n: null };
		const band = [0, 1, 2].filter((a) => Math.abs(p[a]) > inner[a] + 1e-9);
		if (band.length < 2) return { p, n: null };
		const signs: [number, number, number] = [Math.sign(p[0]) || 1, Math.sign(p[1]) || 1, Math.sign(p[2]) || 1];
		const edgeOn = (axis: number) => selected.has(edgeName(axis, signs));
		const clamp = (a: number) => Math.sign(p[a]) * Math.min(Math.abs(p[a]), inner[a]);
		if (band.length === 3 && [0, 1, 2].every(edgeOn)) {
			const d = [0, 1, 2].map((a) => p[a] - clamp(a));
			const len = Math.hypot(d[0], d[1], d[2]) || 1;
			const n: [number, number, number] = [d[0] / len, d[1] / len, d[2] / len];
			return { p: [clamp(0) + r * n[0], clamp(1) + r * n[1], clamp(2) + r * n[2]], n };
		}
		let best: { p: [number, number, number]; n: [number, number, number] | null } | null = null;
		let deepest = 1e-12;
		for (let x = 0; x < band.length; x++) {
			for (let y = x + 1; y < band.length; y++) {
				const [i, j] = [band[x], band[y]];
				const along = 3 - i - j;
				if (!edgeOn(along)) continue;
				const di = p[i] - clamp(i);
				const dj = p[j] - clamp(j);
				const len = Math.hypot(di, dj);
				if (len === 0) continue;
				const q: [number, number, number] = [p[0], p[1], p[2]];
				const n: [number, number, number] = [0, 0, 0];
				// On the cap (the flat end of the edge) the corner square is squeezed into the quarter disc, so no triangle folds over.
				const reach = along === face ? Math.max(Math.abs(di), Math.abs(dj)) : r;
				q[i] = clamp(i) + (reach * di) / len;
				q[j] = clamp(j) + (reach * dj) / len;
				n[i] = di / len;
				n[j] = dj / len;
				const moved = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
				// The flat end of a rounded edge is a cap: its points follow the round but it still faces straight out.
				if (moved > deepest) { deepest = moved; best = { p: q, n: along === face ? null : n }; }
			}
		}
		return best ?? { p, n: null };
	};

	for (const face of FACES) {
		const faceNormal: [number, number, number] = [0, 0, 0];
		faceNormal[face.k] = face.s;
		const us = coords[face.u[0]];
		const vs = coords[face.v[0]];
		const base = positions.length / 3;
		for (let j = 0; j < vs.length; j++) {
			for (let i = 0; i < us.length; i++) {
				const p: [number, number, number] = [0, 0, 0];
				p[face.k] = face.s * half[face.k];
				p[face.u[0]] = us[i];
				p[face.v[0]] = vs[j];
				const moved = round(p, face.k);
				positions.push(...moved.p);
				normals.push(...(moved.n ?? faceNormal));
				uvs.push(0.5 + (0.5 * face.u[1] * p[face.u[0]]) / half[face.u[0]], 0.5 + (0.5 * face.v[1] * p[face.v[0]]) / half[face.v[0]]);
			}
		}
		// Babylon draws a triangle whose edges turn against its normal: flip the order for the faces that come out the other way.
		const eu = [0, 0, 0];
		const ev = [0, 0, 0];
		eu[face.u[0]] = 1;
		ev[face.v[0]] = 1;
		const cross = [eu[1] * ev[2] - eu[2] * ev[1], eu[2] * ev[0] - eu[0] * ev[2], eu[0] * ev[1] - eu[1] * ev[0]];
		const flip = cross[0] * faceNormal[0] + cross[1] * faceNormal[1] + cross[2] * faceNormal[2] > 0;
		const width = us.length;
		for (let j = 0; j < vs.length - 1; j++) {
			for (let i = 0; i < us.length - 1; i++) {
				const a = base + j * width + i;
				const b = a + 1;
				const c = a + width + 1;
				const d = a + width;
				if (flip) indices.push(a, c, b, a, d, c);
				else indices.push(a, b, c, a, c, d);
			}
		}
	}
	return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}

/**
 * The same shape for a mesh that is drawn at `scale`: its vertices are divided by the scale so that, once the object is scaled, the
 * rounds are `radius` metres on every side. The normals are turned the same way the scale turns them.
 */
export function roundedBoxForScale(scale: readonly [number, number, number], radius: number, edges?: readonly string[], segments = DEFAULT_ROUND_SEGMENTS): RoundedBoxData {
	const s = scale.map((v) => Math.max(Math.abs(v), 1e-4)) as [number, number, number];
	const data = roundedBox(s, radius, edges, segments);
	for (let v = 0; v < data.positions.length; v += 3) {
		const n = [data.normals[v] * s[0], data.normals[v + 1] * s[1], data.normals[v + 2] * s[2]];
		const len = Math.hypot(n[0], n[1], n[2]) || 1;
		for (let a = 0; a < 3; a++) {
			data.positions[v + a] /= s[a];
			data.normals[v + a] = n[a] / len;
		}
	}
	return data;
}
