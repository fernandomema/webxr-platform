// Small vector and quaternion helpers for the director: plain arrays, no classes, so that they bundle into the script as they are.
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: readonly number[]): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const qyaw = (y: number): Q4 => [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
export const qx = (a: number): Q4 => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export const qroll = (deg: number): Q4 => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];
export const qmul = (a: Q4, b: Q4): Q4 => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];

/** The turn that takes +z to the direction `d` (no roll): a streak that points along the way it flies. */
export function lookAlong(d: readonly number[]): Q4 {
	const yaw = Math.atan2(d[0], d[2]), pitch = -Math.asin(clamp(d[1], -1, 1));
	return qmul(qyaw(yaw), qx(pitch));
}

/** The horizontal part of a direction, as a unit vector. */
export const flat = (v: readonly number[]): V3 => norm([v[0], 0, v[2]]);

export const angleBetween = (a: readonly number[], b: readonly number[]): number => Math.acos(clamp(dot(a, b), -1, 1));

/** Turns a direction toward another by at most `step` radians. */
export function turnToward(from: V3, to: V3, step: number): V3 {
	const angle = angleBetween(from, to);
	if (angle <= step || angle < 1e-6) return to;
	const k = step / angle;
	return norm(add(mul(from, 1 - k), mul(to, k)));
}

/** Squared distance between the segments p1-q1 and p2-q2, and where on the first one they are closest (0..1). */
export function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): { d2: number; s: number } {
	const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
	const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
	let s: number, t: number;
	if (a < 1e-9 && e < 1e-9) return { d2: dot(r, r), s: 0 };
	if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
	else {
		const c = dot(d1, r);
		if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
		else {
			const b = dot(d1, d2), denom = a * e - b * b;
			s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
			t = (b * s + f) / e;
			if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
			else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
		}
	}
	const c1 = add(p1, mul(d1, s)), c2 = add(p2, mul(d2, t));
	const diff = sub(c1, c2);
	return { d2: dot(diff, diff), s };
}

/** Whether a ray crosses a plain box (centre, size) within `maxT`: for the cards. */
export function rayBox3(p: V3, d: V3, centreAt: V3, size: V3, maxT: number): boolean {
	let tmin = 0, tmax = maxT;
	for (let a = 0; a < 3; a++) {
		const lo = centreAt[a] - size[a] / 2, hi = centreAt[a] + size[a] / 2;
		if (Math.abs(d[a]) < 1e-9) { if (p[a] < lo || p[a] > hi) return false; continue; }
		let t1 = (lo - p[a]) / d[a], t2 = (hi - p[a]) / d[a];
		if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
		tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
		if (tmin > tmax) return false;
	}
	return true;
}

/**
 * The way to point a gun so that a bullet (which falls) lands on a point, in the plane of the shot: the flattest angle that gets there, or
 * null when the point is out of range. `lift` is the push up the bullet is given when it leaves; `v` its speed and `g` how fast it falls.
 */
export function solveArc(r: number, dy: number, v: number, g: number, lift: number): { deg: number; t: number } | null {
	let best: { deg: number; error: number; t: number } | null = null;
	for (let deg = -60; deg <= 75; deg += 0.5) {
		const a = (deg * Math.PI) / 180, c = Math.cos(a);
		if (c < 0.05) continue;
		const t = r / (v * c);
		const y = (v * Math.sin(a) + lift) * t - 0.5 * g * t * t;
		const error = y - dy;
		// The first angle (from flat upward) where the bullet crosses the height of the target at that distance.
		if (best && Math.sign(best.error) !== Math.sign(error) && best.deg < deg) return { deg: deg - 0.25, t };
		best = { deg, error, t };
	}
	return null;
}

/** A small seeded dice (mulberry32): the clock is the seed, so a test that fixes the clock gets the same game every time. */
export function makeDice(seedFrom: number): () => number {
	let seed = (seedFrom ^ 0x9e3779b9) >>> 0;
	return () => {
		seed = (seed + 0x6d2b79f5) >>> 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
