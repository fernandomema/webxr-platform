import type { Mat4, V3 } from './types.ts';

/**
 * Matrices as Babylon builds them for a node: a point `v` becomes `v * M`, so a transform `A` followed by `B` is `A * B`, and a
 * node's world matrix is `local * parentWorld` with `local = Scale * Rotation * Translation`.
 */

export const identity = (): Mat4 => {
	const m = new Float64Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
};

/** `a * b`: first `a`, then `b`. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
	const r = new Float64Array(16);
	for (let row = 0; row < 4; row++) {
		for (let col = 0; col < 4; col++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[row * 4 + k] * b[k * 4 + col];
			r[row * 4 + col] = sum;
		}
	}
	return r;
}

/** `local = Scale * Rotation * Translation` for a slot's position, quaternion [x, y, z, w] and scale. */
export function compose(position: V3, rotation: [number, number, number, number], scale: V3): Mat4 {
	let [x, y, z, w] = rotation;
	const length = Math.hypot(x, y, z, w) || 1;
	x /= length; y /= length; z /= length; w /= length;
	const xx = x * x, yy = y * y, zz = z * z, xy = x * y, zw = z * w, zx = z * x, yw = y * w, yz = y * z, xw = x * w;
	const m = new Float64Array(16);
	m[0] = (1 - 2 * (yy + zz)) * scale[0]; m[1] = 2 * (xy + zw) * scale[0]; m[2] = 2 * (zx - yw) * scale[0];
	m[4] = 2 * (xy - zw) * scale[1]; m[5] = (1 - 2 * (zz + xx)) * scale[1]; m[6] = 2 * (yz + xw) * scale[1];
	m[8] = 2 * (zx + yw) * scale[2]; m[9] = 2 * (yz - xw) * scale[2]; m[10] = (1 - 2 * (yy + xx)) * scale[2];
	m[12] = position[0]; m[13] = position[1]; m[14] = position[2]; m[15] = 1;
	return m;
}

/** The general inverse, or null for a matrix that squashes space flat (a zero scale). */
export function invert(m: Mat4): Mat4 | null {
	const a = Array.from(m);
	const inv = Array.from(identity());
	for (let col = 0; col < 4; col++) {
		let pivot = col;
		for (let row = col + 1; row < 4; row++) if (Math.abs(a[row * 4 + col]) > Math.abs(a[pivot * 4 + col])) pivot = row;
		if (Math.abs(a[pivot * 4 + col]) < 1e-12) return null;
		if (pivot !== col) {
			for (let k = 0; k < 4; k++) {
				[a[col * 4 + k], a[pivot * 4 + k]] = [a[pivot * 4 + k], a[col * 4 + k]];
				[inv[col * 4 + k], inv[pivot * 4 + k]] = [inv[pivot * 4 + k], inv[col * 4 + k]];
			}
		}
		const d = a[col * 4 + col];
		for (let k = 0; k < 4; k++) { a[col * 4 + k] /= d; inv[col * 4 + k] /= d; }
		for (let row = 0; row < 4; row++) {
			if (row === col) continue;
			const f = a[row * 4 + col];
			if (f === 0) continue;
			for (let k = 0; k < 4; k++) { a[row * 4 + k] -= f * a[col * 4 + k]; inv[row * 4 + k] -= f * inv[col * 4 + k]; }
		}
	}
	return Float64Array.from(inv);
}

export const transformPoint = (m: Mat4, p: V3): V3 => [
	p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
	p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
	p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14]
];

export const transformDirection = (m: Mat4, d: V3): V3 => [
	d[0] * m[0] + d[1] * m[4] + d[2] * m[8],
	d[0] * m[1] + d[1] * m[5] + d[2] * m[9],
	d[0] * m[2] + d[1] * m[6] + d[2] * m[10]
];

/**
 * A normal given in local space, in world space: it goes through the inverse-transpose of the matrix, which is the transpose of
 * the *world to local* matrix `inverse` applied to a row vector, so `n * transpose(inverse)`.
 */
export const transformNormal = (inverse: Mat4, n: V3): V3 => {
	const r: V3 = [
		n[0] * inverse[0] + n[1] * inverse[1] + n[2] * inverse[2],
		n[0] * inverse[4] + n[1] * inverse[5] + n[2] * inverse[6],
		n[0] * inverse[8] + n[1] * inverse[9] + n[2] * inverse[10]
	];
	const l = Math.hypot(r[0], r[1], r[2]) || 1;
	return [r[0] / l, r[1] / l, r[2] / l];
};

/** The determinant of the upper 3x3: negative when the transform mirrors. */
export const determinant3 = (m: Mat4): number =>
	m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
