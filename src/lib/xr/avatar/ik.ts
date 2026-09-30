/**
 * Pure maths behind the avatar puppet: which way the body faces, how tall the
 * player stands, and where an elbow or knee goes. Plain arrays, no Babylon, so
 * it runs (and is tested) in Node. Babylon conventions: left-handed, Y up,
 * a camera with no rotation looks along +Z, and a positive yaw turns +Z towards +X.
 */

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => {
	const l = length(a);
	return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Rotates a vector by a unit quaternion (x, y, z, w). */
export function rotateVector(q: Q4, v: V3): V3 {
	const [qx, qy, qz, qw] = q;
	// t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
	const tx = 2 * (qy * v[2] - qz * v[1]);
	const ty = 2 * (qz * v[0] - qx * v[2]);
	const tz = 2 * (qx * v[1] - qy * v[0]);
	return [
		v[0] + qw * tx + (qy * tz - qz * ty),
		v[1] + qw * ty + (qz * tx - qx * tz),
		v[2] + qw * tz + (qx * ty - qy * tx)
	];
}

const wrapAngle = (angle: number) => {
	let a = (angle + Math.PI) % (2 * Math.PI);
	if (a < 0) a += 2 * Math.PI;
	return a - Math.PI;
};

/**
 * The direction a head is facing, as a yaw. When the player looks almost straight up or down the
 * forward vector is nearly vertical and useless, so the head's up vector (which then leans
 * forward or back) stands in for it.
 */
export function headYaw(rotation: Q4): number {
	const forward = rotateVector(rotation, [0, 0, 1]);
	if (Math.hypot(forward[0], forward[2]) >= 0.35) return Math.atan2(forward[0], forward[2]);
	const up = rotateVector(rotation, [0, 1, 0]);
	// Looking down: up points forward. Looking up: up points backward.
	const sign = forward[1] < 0 ? 1 : -1;
	return Math.atan2(up[0] * sign, up[2] * sign);
}

/**
 * Eases the body's yaw towards the head's. The body follows lazily, so turning the head a little
 * does not swivel the whole avatar; past `deadZone` it catches up.
 */
export function followYaw(current: number, target: number, dt: number, deadZone = 0.6, rate = 5): number {
	const diff = wrapAngle(target - current);
	if (Math.abs(diff) < deadZone) return current + diff * (1 - Math.exp(-dt * rate * 0.25));
	return current + diff * (1 - Math.exp(-dt * rate));
}

/**
 * Which way a model faces at rest, from where its hands are: a model that faces +Z has its left
 * hand on -X. Returns the yaw that turns the model to face +Z (0 or PI).
 */
export function restFacingYaw(leftHandX: number, rightHandX: number): number {
	return leftHandX <= rightHandX ? 0 : Math.PI;
}

/** Yaw as a quaternion about +Y. */
export function yawQuat(yaw: number): Q4 {
	return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/**
 * Tracks the player's standing eye height: the highest their head has been, clamped to a plausible
 * range and eased down slowly so a session that began seated recovers.
 */
export function updateStandingHeight(current: number, headHeight: number, dt: number): number {
	const clamped = Math.min(2.3, Math.max(0.5, headHeight));
	if (clamped >= current) return clamped;
	return Math.max(clamped, current - 0.02 * dt);
}

export interface TwoBoneSolution {
	/** The middle joint (elbow or knee). */
	mid: V3;
	/** Where the end joint ends up: the target, or as close as the limb can reach. */
	end: V3;
}

/**
 * Two-bone IK: places the middle joint of a limb of lengths `upper` and `lower` starting at `root`
 * so its end reaches `target`. `pole` is the direction the joint should bend towards (elbows back
 * and down, knees forward). Out-of-reach targets stretch the limb straight towards them.
 */
export function solveTwoBone(root: V3, target: V3, upper: number, lower: number, pole: V3): TwoBoneSolution {
	const toTarget = sub(target, root);
	const distance = length(toTarget);
	const direction = distance > 1e-9 ? scale(toTarget, 1 / distance) : ([0, -1, 0] as V3);
	const reach = upper + lower;
	// Keep a hair of bend so the limb never locks perfectly straight, and never fold fully shut.
	const clamped = Math.min(Math.max(distance, Math.abs(upper - lower) + 1e-4), reach - 1e-4);
	const end = add(root, scale(direction, clamped));

	// Law of cosines: the angle at the root between the target direction and the upper bone.
	const cosRoot = (upper * upper + clamped * clamped - lower * lower) / (2 * upper * clamped);
	const angle = Math.acos(Math.min(1, Math.max(-1, cosRoot)));
	// The bend plane: the pole direction with its component along the limb removed.
	let side = sub(pole, scale(direction, dot(pole, direction)));
	if (length(side) < 1e-6) side = sub([0, 0, -1], scale(direction, dot([0, 0, -1], direction)));
	side = normalize(side);
	const along = Math.cos(angle) * upper;
	const across = Math.sin(angle) * upper;
	const mid = add(add(root, scale(direction, along)), scale(side, across));
	return { mid, end };
}

/** The shortest-arc rotation taking direction `from` onto direction `to` (both need not be unit length). */
export function arcBetween(from: V3, to: V3): Q4 {
	const a = normalize(from);
	const b = normalize(to);
	const d = dot(a, b);
	if (d > 0.999999) return [0, 0, 0, 1];
	if (d < -0.999999) {
		// Opposite: any perpendicular axis will do.
		const axis = Math.abs(a[0]) < 0.9 ? normalize([0, a[2], -a[1]]) : normalize([-a[2], 0, a[0]]);
		return [axis[0], axis[1], axis[2], 0];
	}
	// Babylon's cross-product handedness matches the standard formula for this quaternion construction
	// when rotating vectors with `rotateVector`, so a plain cross(a, b) axis works.
	const axis: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const w = 1 + d;
	const l = Math.hypot(axis[0], axis[1], axis[2], w);
	return [axis[0] / l, axis[1] / l, axis[2] / l, w / l];
}
