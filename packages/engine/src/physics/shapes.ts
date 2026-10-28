/**
 * Solid shapes and the questions asked of them: how far a point is, where a ray enters. Pure maths (no Babylon), so the character
 * controller, the script API (`ctx.physics`) and the tests all run the same code, in the page, in the sandbox's host and in Node.
 */

export type V3 = [number, number, number];

/** An oriented box: its middle, half its size along each of its three axes, and those axes (unit vectors, a rotation's columns). */
export interface BoxShape {
	kind: 'box';
	center: V3;
	half: V3;
	axes: [V3, V3, V3];
}

export interface SphereShape {
	kind: 'sphere';
	center: V3;
	radius: number;
}

/** A cylinder with flat ends: its middle, the direction of its axis (a unit vector), its radius and half its length. */
export interface CylinderShape {
	kind: 'cylinder';
	center: V3;
	axis: V3;
	radius: number;
	halfLength: number;
}

export type Shape = BoxShape | SphereShape | CylinderShape;

export interface Bounds {
	min: V3;
	max: V3;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => {
	const l = length(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The columns of the rotation a unit quaternion `[x, y, z, w]` stands for: where the local x, y and z axes point. */
export function axesOf(q: readonly [number, number, number, number]): [V3, V3, V3] {
	const [x, y, z, w] = q;
	const n = Math.hypot(x, y, z, w) || 1;
	const qx = x / n, qy = y / n, qz = z / n, qw = w / n;
	return [
		[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw)],
		[2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw)],
		[2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)]
	];
}

export const box = (center: V3, half: V3, rotation: readonly [number, number, number, number] = [0, 0, 0, 1]): BoxShape => ({ kind: 'box', center, half, axes: axesOf(rotation) });
export const sphere = (center: V3, radius: number): SphereShape => ({ kind: 'sphere', center, radius });
/** `rotation` turns the cylinder's own up (+y) to where its axis points. */
export const cylinder = (center: V3, radius: number, halfLength: number, rotation: readonly [number, number, number, number] = [0, 0, 0, 1]): CylinderShape => ({ kind: 'cylinder', center, axis: axesOf(rotation)[1], radius, halfLength });

/** The smallest axis-aligned box around a shape. */
export function boundsOf(shape: Shape): Bounds {
	if (shape.kind === 'sphere') {
		const r = shape.radius;
		return { min: [shape.center[0] - r, shape.center[1] - r, shape.center[2] - r], max: [shape.center[0] + r, shape.center[1] + r, shape.center[2] + r] };
	}
	if (shape.kind === 'box') {
		const e: V3 = [0, 0, 0];
		for (let k = 0; k < 3; k++) e[k] = Math.abs(shape.axes[0][k]) * shape.half[0] + Math.abs(shape.axes[1][k]) * shape.half[1] + Math.abs(shape.axes[2][k]) * shape.half[2];
		return { min: sub(shape.center, e), max: add(shape.center, e) };
	}
	// A cylinder: the ends are discs, whose extent along each axis is the radius times the sine of the angle to it.
	const e: V3 = [0, 0, 0];
	for (let k = 0; k < 3; k++) e[k] = Math.abs(shape.axis[k]) * shape.halfLength + shape.radius * Math.sqrt(Math.max(0, 1 - shape.axis[k] * shape.axis[k]));
	return { min: sub(shape.center, e), max: add(shape.center, e) };
}

/** What a point is to a shape: its signed distance (negative inside), the nearest point on the surface, and the way out (a unit normal). */
export interface Nearest {
	distance: number;
	point: V3;
	normal: V3;
}

export function nearest(shape: Shape, p: V3): Nearest {
	if (shape.kind === 'sphere') {
		const d = sub(p, shape.center);
		const l = length(d);
		const normal: V3 = l > 1e-9 ? scale(d, 1 / l) : [0, 1, 0];
		return { distance: l - shape.radius, point: add(shape.center, scale(normal, shape.radius)), normal };
	}
	if (shape.kind === 'box') {
		const d = sub(p, shape.center);
		const q: V3 = [dot(d, shape.axes[0]), dot(d, shape.axes[1]), dot(d, shape.axes[2])];
		const c: V3 = [clamp(q[0], -shape.half[0], shape.half[0]), clamp(q[1], -shape.half[1], shape.half[1]), clamp(q[2], -shape.half[2], shape.half[2])];
		const out: V3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
		const fromAxes = (v: V3): V3 => add(add(scale(shape.axes[0], v[0]), scale(shape.axes[1], v[1])), scale(shape.axes[2], v[2]));
		const l = length(out);
		if (l > 1e-9) return { distance: l, point: add(shape.center, fromAxes(c)), normal: normalize(fromAxes(out)) };
		// Inside: out by the nearest face.
		let axis = 0, best = Infinity;
		for (let k = 0; k < 3; k++) {
			const gap = shape.half[k] - Math.abs(q[k]);
			if (gap < best) { best = gap; axis = k; }
		}
		const side = q[axis] < 0 ? -1 : 1;
		const surface: V3 = [q[0], q[1], q[2]];
		surface[axis] = side * shape.half[axis];
		return { distance: -best, point: add(shape.center, fromAxes(surface)), normal: scale(shape.axes[axis], side) };
	}
	const d = sub(p, shape.center);
	const along = dot(d, shape.axis);
	const radial = sub(d, scale(shape.axis, along));
	const rl = length(radial);
	const radialDir: V3 = rl > 1e-9 ? scale(radial, 1 / rl) : perpendicular(shape.axis);
	const dr = rl - shape.radius, da = Math.abs(along) - shape.halfLength;
	const side = along < 0 ? -1 : 1;
	if (dr > 0 || da > 0) {
		const cr = Math.min(rl, shape.radius), ca = clamp(along, -shape.halfLength, shape.halfLength);
		const point = add(shape.center, add(scale(shape.axis, ca), scale(radialDir, cr)));
		const out = sub(p, point);
		const l = length(out);
		return { distance: l, point, normal: l > 1e-9 ? scale(out, 1 / l) : radialDir };
	}
	// Inside: out by the nearest of the side and the two ends.
	if (-dr < -da) {
		return { distance: dr, point: add(shape.center, add(scale(shape.axis, along), scale(radialDir, shape.radius))), normal: radialDir };
	}
	return { distance: da, point: add(shape.center, add(scale(shape.axis, side * shape.halfLength), radial)), normal: scale(shape.axis, side) };
}

function perpendicular(axis: V3): V3 {
	const other: V3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	const c: V3 = [axis[1] * other[2] - axis[2] * other[1], axis[2] * other[0] - axis[0] * other[2], axis[0] * other[1] - axis[1] * other[0]];
	return normalize(c);
}

export interface RayHit {
	/** Distance along the ray. */
	t: number;
	point: V3;
	normal: V3;
}

/** Where a ray (a unit `direction`) first enters a shape within `maxT`; null when it does not. A ray that starts inside hits at 0. */
export function rayShape(shape: Shape, origin: V3, direction: V3, maxT: number): RayHit | null {
	const at = (t: number, normal: V3): RayHit => ({ t, point: add(origin, scale(direction, t)), normal });
	if (shape.kind === 'sphere') {
		const oc = sub(origin, shape.center);
		const b = dot(oc, direction), c = dot(oc, oc) - shape.radius * shape.radius;
		if (c <= 0) return at(0, normalize(oc));
		const disc = b * b - c;
		if (b > 0 || disc < 0) return null;
		const t = -b - Math.sqrt(disc);
		return t >= 0 && t <= maxT ? at(t, normalize(add(oc, scale(direction, t)))) : null;
	}
	if (shape.kind === 'box') {
		const oc = sub(origin, shape.center);
		let tmin = 0, tmax = maxT, normal: V3 | null = null;
		for (let k = 0; k < 3; k++) {
			const o = dot(oc, shape.axes[k]), d = dot(direction, shape.axes[k]), h = shape.half[k];
			if (Math.abs(d) < 1e-12) {
				if (o < -h || o > h) return null;
				continue;
			}
			let t1 = (-h - o) / d, t2 = (h - o) / d, side = -1;
			if (t1 > t2) { const s = t1; t1 = t2; t2 = s; side = 1; }
			if (t1 > tmin) { tmin = t1; normal = scale(shape.axes[k], side); }
			tmax = Math.min(tmax, t2);
			if (tmin > tmax) return null;
		}
		return normal ? at(tmin, normal) : at(0, scale(direction, -1));
	}
	// A cylinder: its side as a circle in the plane across the axis, then its two ends.
	const oc = sub(origin, shape.center);
	const oa = dot(oc, shape.axis), da = dot(direction, shape.axis);
	const op = sub(oc, scale(shape.axis, oa)), dp = sub(direction, scale(shape.axis, da));
	let best: RayHit | null = null;
	const consider = (hit: RayHit | null) => { if (hit && (!best || hit.t < best.t)) best = hit; };
	const a = dot(dp, dp);
	if (a > 1e-12) {
		const b = dot(op, dp), c = dot(op, op) - shape.radius * shape.radius;
		const disc = b * b - a * c;
		if (disc >= 0) {
			const t = (-b - Math.sqrt(disc)) / a;
			if (t >= 0 && t <= maxT) {
				const ay = oa + da * t;
				if (Math.abs(ay) <= shape.halfLength) consider(at(t, normalize(add(op, scale(dp, t)))));
			}
		}
	}
	if (Math.abs(da) > 1e-12) {
		for (const side of [-1, 1]) {
			const t = (side * shape.halfLength - oa) / da;
			if (t < 0 || t > maxT) continue;
			const r = add(op, scale(dp, t));
			if (dot(r, r) <= shape.radius * shape.radius) consider(at(t, scale(shape.axis, side)));
		}
	}
	if (!best && nearest(shape, origin).distance <= 0) return at(0, scale(direction, -1));
	return best;
}
