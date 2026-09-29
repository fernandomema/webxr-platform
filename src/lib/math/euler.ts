import type { Quat, Vec3 } from '../ecs/types';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * Euler angles (degrees) in the same yaw-pitch-roll (Y, X, Z) order Babylon
 * uses, so the Studio inspector agrees with what the renderer shows.
 */
export function quatToEuler([x, y, z, w]: Quat): Vec3 {
	const len = Math.hypot(x, y, z, w) || 1;
	x /= len;
	y /= len;
	z /= len;
	w /= len;

	const m11 = 1 - 2 * (y * y + z * z);
	const m13 = 2 * (x * z + y * w);
	const m21 = 2 * (x * y + z * w);
	const m22 = 1 - 2 * (x * x + z * z);
	const m23 = 2 * (y * z - x * w);
	const m31 = 2 * (x * z - y * w);
	const m33 = 1 - 2 * (x * x + y * y);

	const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)));
	let yaw: number;
	let roll: number;
	if (Math.abs(m23) < 0.9999999) {
		yaw = Math.atan2(m13, m33);
		roll = Math.atan2(m21, m22);
	} else {
		yaw = Math.atan2(-m31, m11);
		roll = 0;
	}
	return [pitch * DEG, yaw * DEG, roll * DEG];
}

export function eulerToQuat([pitchDeg, yawDeg, rollDeg]: Vec3): Quat {
	const halfPitch = pitchDeg * RAD * 0.5;
	const halfYaw = yawDeg * RAD * 0.5;
	const halfRoll = rollDeg * RAD * 0.5;
	const sp = Math.sin(halfPitch);
	const cp = Math.cos(halfPitch);
	const sy = Math.sin(halfYaw);
	const cy = Math.cos(halfYaw);
	const sr = Math.sin(halfRoll);
	const cr = Math.cos(halfRoll);
	return [
		cy * sp * cr + sy * cp * sr,
		sy * cp * cr - cy * sp * sr,
		cy * cp * sr - sy * sp * cr,
		cy * cp * cr + sy * sp * sr
	];
}

/** Rounds to a display-friendly precision and avoids "-0". */
export function roundDisplay(value: number, digits = 3): number {
	const factor = 10 ** digits;
	const rounded = Math.round(value * factor) / factor;
	return Object.is(rounded, -0) ? 0 : rounded;
}
