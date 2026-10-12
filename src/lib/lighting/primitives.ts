import { determinant3, transformDirection, transformNormal, transformPoint } from './matrix.ts';
import type { BakePrimitive, Mat4, PrimitiveShape, V3 } from './types.ts';

/** A hit nearer than this (in metres along a unit ray) is the surface the ray started from. */
export const T_EPS = 1e-4;

export interface Hit {
	/** Distance along the (unit) ray. */
	t: number;
	/** World-space unit normal, turned to face the ray. */
	normal: V3;
}

/** The bounds of a shape in its own space: the renderer's built-in meshes (box 1, sphere diameter 1, cylinder 1 by 1 along Y, plane 1 in XY, ground 20 in XZ, disc diameter 1 in XZ). */
const LOCAL_BOUNDS: Record<PrimitiveShape, { min: V3; max: V3 }> = {
	box: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
	sphere: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
	cylinder: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
	plane: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 0] },
	ground: { min: [-10, 0, -10], max: [10, 0, 10] },
	disc: { min: [-0.5, 0, -0.5], max: [0.5, 0, 0.5] }
};

/** Whether a shape encloses a volume (light cannot be inside it) or is a flat sheet. */
export const isSolidShape = (shape: PrimitiveShape): boolean => shape === 'box' || shape === 'sphere' || shape === 'cylinder';

export function worldBounds(shape: PrimitiveShape, world: Mat4): { min: V3; max: V3 } {
	const { min, max } = LOCAL_BOUNDS[shape];
	const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < 8; i++) {
		const p = transformPoint(world, [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
		for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
	}
	// A sheet has no thickness; give it a hair so it can sit in a grid cell.
	for (let k = 0; k < 3; k++) { lo[k] -= 1e-3; hi[k] += 1e-3; }
	return { min: lo, max: hi };
}

/** The first point where the ray enters the shape, in the shape's own space, as `[t, local normal]`; or null. A ray that starts inside a solid sees nothing of it. */
function local(shape: PrimitiveShape, o: V3, d: V3, tMax: number): [number, V3] | null {
	switch (shape) {
		case 'box': {
			let tMin = -Infinity, tFar = Infinity, axis = 0, sign = 1;
			for (let i = 0; i < 3; i++) {
				if (Math.abs(d[i]) < 1e-12) { if (o[i] < -0.5 || o[i] > 0.5) return null; continue; }
				let t1 = (-0.5 - o[i]) / d[i], t2 = (0.5 - o[i]) / d[i], s = -1;
				if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
				if (t1 > tMin) { tMin = t1; axis = i; sign = s; }
				tFar = Math.min(tFar, t2);
				if (tMin > tFar) return null;
			}
			if (tMin <= T_EPS || tMin >= tMax) return null;
			const n: V3 = [0, 0, 0];
			n[axis] = sign;
			return [tMin, n];
		}
		case 'sphere': {
			const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
			const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - 0.25, disc = b * b - a * c;
			if (disc < 0 || c < 0) return null;
			const t = (-b - Math.sqrt(disc)) / a;
			if (t <= T_EPS || t >= tMax) return null;
			const p: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
			return [t, p];
		}
		case 'cylinder': {
			if (o[0] * o[0] + o[2] * o[2] < 0.25 && Math.abs(o[1]) < 0.5) return null;
			let best = Infinity;
			let normal: V3 = [0, 0, 0];
			const a = d[0] * d[0] + d[2] * d[2];
			if (a > 1e-12) {
				const b = o[0] * d[0] + o[2] * d[2], c = o[0] * o[0] + o[2] * o[2] - 0.25, disc = b * b - a * c;
				if (disc >= 0) {
					const t = (-b - Math.sqrt(disc)) / a;
					const y = o[1] + d[1] * t;
					if (t > T_EPS && t < best && Math.abs(y) <= 0.5) { best = t; normal = [o[0] + d[0] * t, 0, o[2] + d[2] * t]; }
				}
			}
			if (Math.abs(d[1]) > 1e-12) {
				for (const cap of [-0.5, 0.5]) {
					const t = (cap - o[1]) / d[1];
					const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
					if (t > T_EPS && t < best && x * x + z * z <= 0.25) { best = t; normal = [0, Math.sign(cap), 0]; }
				}
			}
			return best < tMax ? [best, normal] : null;
		}
		case 'plane': {
			if (Math.abs(d[2]) < 1e-12) return null;
			const t = -o[2] / d[2];
			if (t <= T_EPS || t >= tMax) return null;
			const x = o[0] + d[0] * t, y = o[1] + d[1] * t;
			return Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 ? [t, [0, 0, d[2] > 0 ? -1 : 1]] : null;
		}
		case 'ground': {
			if (Math.abs(d[1]) < 1e-12) return null;
			const t = -o[1] / d[1];
			if (t <= T_EPS || t >= tMax) return null;
			const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
			return Math.abs(x) <= 10 && Math.abs(z) <= 10 ? [t, [0, d[1] > 0 ? -1 : 1, 0]] : null;
		}
		case 'disc': {
			if (Math.abs(d[1]) < 1e-12) return null;
			const t = -o[1] / d[1];
			if (t <= T_EPS || t >= tMax) return null;
			const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
			return x * x + z * z <= 0.25 ? [t, [0, d[1] > 0 ? -1 : 1, 0]] : null;
		}
	}
}

/** The nearest place a unit ray from `o` along `d` meets the primitive within `tMax`, or null. */
export function intersect(primitive: BakePrimitive, o: V3, d: V3, tMax: number): Hit | null {
	const found = local(primitive.shape, transformPoint(primitive.inverse, o), transformDirection(primitive.inverse, d), tMax);
	if (!found) return null;
	let normal = transformNormal(primitive.inverse, found[1]);
	if (normal[0] * d[0] + normal[1] * d[1] + normal[2] * d[2] > 0) normal = [-normal[0], -normal[1], -normal[2]];
	return { t: found[0], normal };
}

/** Whether a point is inside a solid shape. */
export function insideSolid(primitive: BakePrimitive, p: V3): boolean {
	if (!isSolidShape(primitive.shape)) return false;
	const q = transformPoint(primitive.inverse, p);
	switch (primitive.shape) {
		case 'box': return Math.abs(q[0]) < 0.5 && Math.abs(q[1]) < 0.5 && Math.abs(q[2]) < 0.5;
		case 'sphere': return q[0] * q[0] + q[1] * q[1] + q[2] * q[2] < 0.25;
		default: return q[0] * q[0] + q[2] * q[2] < 0.25 && Math.abs(q[1]) < 0.5;
	}
}

export { determinant3 };
