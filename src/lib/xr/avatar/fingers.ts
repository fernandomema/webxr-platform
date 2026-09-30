/**
 * The maths behind an avatar's fingers. A hand travels over the network as a wrist pose plus five
 * numbers, one per finger, from 0 (open) to 1 (fully curled). Where those numbers come from depends on
 * the device: joints when hands are tracked, trigger/grip/touch sensors on a controller.
 * Pure: plain arrays, tested in Node. Babylon conventions (left-handed, Y up, +Z forward).
 */

import { rotateVector, type Q4, type V3 } from './ik.ts';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];
/** Curl per finger in `FINGER_NAMES` order. */
export type Curls = [number, number, number, number, number];

export const OPEN_HAND: Curls = [0.15, 0.15, 0.15, 0.15, 0.15];

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => {
	const l = length(a);
	return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Reads and cleans curls off the network: five numbers in range, or nothing. */
export function parseCurls(raw: unknown): Curls | undefined {
	if (!Array.isArray(raw) || raw.length !== 5) return undefined;
	return raw.map((v) => clamp01(typeof v === 'number' ? v : 0)) as Curls;
}

export interface ButtonState {
	value?: number;
	touched?: boolean;
	pressed?: boolean;
}

/**
 * What a hand holding a controller looks like. The fingers rest loosely round the handle; a finger on a
 * button leans into it; pulling the trigger closes the index, squeezing the grip closes the other three.
 * The thumb curls when it is on (or pressing) any of the thumb buttons or the stick.
 */
export function controllerCurls(input: { trigger?: ButtonState; squeeze?: ButtonState; thumb?: ButtonState[] }): Curls {
	const trigger = clamp01(input.trigger?.value ?? 0);
	const squeeze = clamp01(input.squeeze?.value ?? 0);
	const index = trigger > 0.02 ? lerp(0.35, 1, trigger) : input.trigger?.touched ? 0.3 : 0.15;
	const grip = lerp(0.2, 1, squeeze);
	const thumbs = input.thumb ?? [];
	// A thumb holding a controller rests bent over the top of it, leans into a button it touches, presses one it pushes, and
	// wraps over the fingers as the grip closes.
	const onControls = thumbs.some((b) => b.pressed || (b.value ?? 0) > 0.5) ? 0.7 : thumbs.some((b) => b.touched) ? 0.5 : 0.35;
	const thumb = Math.max(onControls, lerp(0.35, 0.85, squeeze));
	return [thumb, index, grip, grip * 0.98, grip * 0.95];
}

/** The angle between two segments, 0 when they continue in a line. */
function bendBetween(a: V3, b: V3): number {
	const la = length(a);
	const lb = length(b);
	if (la < 1e-9 || lb < 1e-9) return 0;
	return Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (la * lb))));
}

/**
 * How curled a finger is, from the positions of its joints (base to tip): the total bend along the chain
 * against how far a full fist bends it (`fullBend`, in radians).
 */
export function jointChainCurl(points: readonly V3[], fullBend: number): number {
	let total = 0;
	for (let i = 1; i + 1 < points.length; i++) total += bendBetween(sub(points[i], points[i - 1]), sub(points[i + 1], points[i]));
	return clamp01(total / fullBend);
}

/**
 * How much total bend counts as fully curled. Equal to what the avatar's fingers add up to at full curl (`JOINT_BEND`),
 * so a measured curl is shown back at the same amount instead of exaggerated.
 */
export const FULL_BEND = { finger: 4.2, thumb: 2.0 } as const;

/** The angle at every inner joint of a chain of points (base to tip): `n` points give `n - 2` bends. */
export function jointBends(points: readonly V3[]): number[] {
	const bends: number[] = [];
	for (let i = 1; i + 1 < points.length; i++) bends.push(bendBetween(sub(points[i], points[i - 1]), sub(points[i + 1], points[i])));
	return bends;
}

/** Joint angles (radians) per finger and joint, thumb to little: 15 numbers. Anything else is ignored. */
export const BEND_COUNT = 15;

/** Reads joint angles off the network: 15 numbers within a human range, or nothing. */
export function parseBends(raw: unknown): number[] | undefined {
	if (!Array.isArray(raw) || raw.length !== BEND_COUNT) return undefined;
	return raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(2.2, Math.max(-0.4, v)) : 0));
}

/** A quaternion from three orthonormal axes: the directions that the X, Y and Z axes are turned onto. */
export function quatFromBasis(x: V3, y: V3, z: V3): Q4 {
	const m00 = x[0], m10 = x[1], m20 = x[2];
	const m01 = y[0], m11 = y[1], m21 = y[2];
	const m02 = z[0], m12 = z[1], m22 = z[2];
	const trace = m00 + m11 + m22;
	let q: Q4;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
	}
	const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/**
 * The orientation of a hand, worked out from where its joints are instead of from what a runtime says
 * its axes are: fingers along +Z and the back of the hand along +Y (so a right hand held palm down,
 * fingers forward, has no rotation). Which side the back of the hand is on depends on whether it is a
 * left or a right hand, which the knuckle order tells apart.
 */
export function handFrameFromKnuckles(wrist: V3, middleKnuckle: V3, indexKnuckle: V3, littleKnuckle: V3, side: 'left' | 'right'): Q4 | null {
	const fingers = normalize(sub(middleKnuckle, wrist));
	const across = normalize(sub(indexKnuckle, littleKnuckle)); // little finger towards index finger
	const raw = cross(across, fingers);
	const back = normalize(side === 'right' ? raw : [-raw[0], -raw[1], -raw[2]]);
	if (length(back) < 1e-6 || length(fingers) < 1e-6) return null;
	const z = normalize(sub(fingers, [back[0] * dot(fingers, back), back[1] * dot(fingers, back), back[2] * dot(fingers, back)]));
	const x = cross(back, z);
	return quatFromBasis(x, back, z);
}

/**
 * How the hand sits on a controller. The grip frame's Z axis runs along the controller's handle, which is the axis of the
 * fist, so the hand's "thumb up" axis is the grip's Z and its "fingers forward" axis is the grip's -Y: the hand frame
 * (fingers forward, thumb up) is the grip frame pitched about X. Tuned against a pistol held with a `[85, 0, 0]` equip
 * pose, and it agrees with where the thumbstick, trigger and squeeze sit on the controller model.
 */
export const CONTROLLER_FIST_PITCH_DEG = 85;

/** Fist centre to wrist, along the forearm, in metres: the avatar's hand bone sits at the wrist, the controller at the fist. */
export const WRIST_BEHIND_GRIP = 0.075;

/** The pitch that turns the hand frame (fingers forward, thumb up) into the controller's grip frame. */
export function fistPitch(): Q4 {
	const half = (CONTROLLER_FIST_PITCH_DEG * Math.PI) / 360;
	return [Math.sin(half), 0, 0, Math.cos(half)];
}

/** The frame a hand is held in when holding a controller, as the roll that turns the sensor's grip frame into the hand frame above. */
export function gripToHandRoll(side: 'left' | 'right'): Q4 {
	// Grip frame: fingers forward, thumb up, palm inward. Hand frame: fingers forward, back of the hand up.
	const half = (side === 'left' ? Math.PI / 2 : -Math.PI / 2) / 2;
	return [0, 0, Math.sin(half), Math.cos(half)];
}

/** How far each joint of a finger bends at full curl, in radians (base, middle, tip joint). */
export const JOINT_BEND: Record<FingerName, [number, number, number]> = {
	thumb: [0.5, 0.7, 0.8],
	index: [1.4, 1.7, 1.1],
	middle: [1.45, 1.75, 1.1],
	ring: [1.4, 1.7, 1.1],
	little: [1.35, 1.65, 1.05]
};

/** Reads the thumb's three segment directions off the network: nine numbers, made into three unit vectors. */
export function parseThumbDirections(raw: unknown): V3[] | undefined {
	if (!Array.isArray(raw) || raw.length !== 9 || !raw.every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
	const out: V3[] = [];
	for (let i = 0; i < 9; i += 3) {
		const d = normalize([raw[i], raw[i + 1], raw[i + 2]] as V3);
		if (length(d) < 0.5) return undefined;
		out.push(d);
	}
	return out;
}

/** The turn undone: the conjugate of a unit quaternion. */
export const conjugate = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];

/** Joint angles (radians, 15: thumb to little, three joints each) for a hand curled by `curls`: each joint takes its share of a full curl. */
export function bendsFromCurls(curls: readonly number[]): number[] {
	return FINGER_NAMES.flatMap((finger, i) => JOINT_BEND[finger].map((max) => (curls[i] ?? 0) * max));
}

/** Eases any list of values towards their targets (joint angles, curls), so 20 Hz packets look smooth. */
export function easeValues(shown: readonly number[], target: readonly number[], dt: number, rate = 18): number[] {
	const k = 1 - Math.exp(-dt * rate);
	return shown.map((value, i) => value + ((target[i] ?? value) - value) * k);
}

/** Eases the curls shown towards the latest ones, so 20 Hz packets look smooth. */
export function easeCurls(shown: Curls, target: Curls, dt: number, rate = 18): Curls {
	const k = 1 - Math.exp(-dt * rate);
	return shown.map((value, i) => value + (target[i] - value) * k) as Curls;
}

/** Rotates a vector by a quaternion; re-exported so callers of this module need only one import. */
export { rotateVector };
