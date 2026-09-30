import { JOINT_BEND, FINGER_NAMES, bendsFromCurls, type Curls } from './fingers.ts';
import { rotateVector, type Q4, type V3 } from './ik.ts';

/**
 * Works out how a hand closes around an object: every finger curls, joint by joint, until it touches. Everything is in
 * the hand's own frame (wrist at the origin, fingers along +Z, back of the hand along +Y), so the same solver serves the
 * Studio's preview hand and the avatars in the game. Pure, and cheap enough to run whenever an object is equipped.
 */

export interface Primitive {
	kind: 'box' | 'sphere' | 'cylinder';
	center: V3;
	rotation: Q4;
	/** Box: half extents. Sphere: the radius in all three. Cylinder: radius, half height (along its own Y), radius. */
	half: V3;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** Negative inside the shape, positive outside: the distance to its surface (exact for a box's outside and for a sphere). */
export function signedDistance(shape: Primitive, point: V3): number {
	const inverse: Q4 = [-shape.rotation[0], -shape.rotation[1], -shape.rotation[2], shape.rotation[3]];
	const p = rotateVector(inverse, sub(point, shape.center));
	if (shape.kind === 'sphere') return Math.hypot(p[0], p[1], p[2]) - shape.half[0];
	if (shape.kind === 'box') {
		const q: V3 = [Math.abs(p[0]) - shape.half[0], Math.abs(p[1]) - shape.half[1], Math.abs(p[2]) - shape.half[2]];
		const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
		return outside + Math.min(Math.max(q[0], q[1], q[2]), 0);
	}
	const radial = Math.hypot(p[0], p[2]) - shape.half[0];
	const vertical = Math.abs(p[1]) - shape.half[1];
	return Math.hypot(Math.max(radial, 0), Math.max(vertical, 0)) + Math.min(Math.max(radial, vertical), 0);
}

export interface FingerModel {
	/** Where the finger starts (the knuckle), in the hand frame. */
	base: V3;
	/** Which way it points when straight. */
	direction: V3;
	/** Which way it curls (towards the palm). */
	palm: V3;
	/** Segment lengths, base to tip. */
	lengths: [number, number, number];
	radius: number;
	/** The most each joint may bend. */
	maxBend: [number, number, number];
}

export type HandModel = FingerModel[];

/** The joints of a finger for given joint angles: knuckle, the next two joints, and the tip. */
export function fingerJoints(finger: FingerModel, bends: readonly number[]): [V3, V3, V3, V3] {
	const d = normalize(finger.direction);
	const across = normalize(sub(finger.palm, scale(d, dot(finger.palm, d))));
	const direction = (angle: number): V3 => add(scale(d, Math.cos(angle)), scale(across, Math.sin(angle)));
	const p0 = finger.base;
	const p1 = add(p0, scale(direction(bends[0]), finger.lengths[0]));
	const p2 = add(p1, scale(direction(bends[0] + bends[1]), finger.lengths[1]));
	const p3 = add(p2, scale(direction(bends[0] + bends[1] + bends[2]), finger.lengths[2]));
	return [p0, p1, p2, p3];
}

function collides(finger: FingerModel, bends: readonly number[], obstacles: readonly Primitive[], fromSegment: number): boolean {
	const joints = fingerJoints(finger, bends);
	for (let segment = fromSegment; segment < 3; segment++) {
		for (const t of [0.34, 0.67, 1]) {
			const point = add(joints[segment], scale(sub(joints[segment + 1], joints[segment]), t));
			for (const shape of obstacles) if (signedDistance(shape, point) < finger.radius) return true;
		}
	}
	return false;
}

export interface FingerGrasp {
	bends: [number, number, number];
	/** False when the finger closed all the way without meeting the object (it is out of reach). */
	touched: boolean;
}

/** Closes one finger joint by joint, base first, until it touches an obstacle or reaches its limit. */
export function solveFinger(finger: FingerModel, obstacles: readonly Primitive[], step = 0.04): FingerGrasp {
	const bends: [number, number, number] = [0, 0, 0];
	let touched = false;
	// A finger that starts inside the object (a hand grabbing straight into a big box) has nothing to wrap: leave it to the relaxed hold.
	if (collides(finger, bends, obstacles, 0)) return { bends, touched: false };
	for (let joint = 0; joint < 3; joint++) {
		while (bends[joint] + step <= finger.maxBend[joint]) {
			const trial: [number, number, number] = [...bends];
			trial[joint] += step;
			if (collides(finger, trial, obstacles, joint)) {
				touched = true;
				break;
			}
			bends[joint] = trial[joint];
		}
	}
	return { bends, touched };
}

/**
 * The 15 joint angles (thumb to little, three each) of a hand closed around `obstacles`. A finger that never reaches
 * the object keeps `relaxed`, so a small or distant object does not make a fist.
 */
export function solveGrasp(hand: HandModel, obstacles: readonly Primitive[], relaxed: readonly number[]): number[] {
	return solveGraspFull(hand, obstacles, relaxed).bends;
}

/** As `solveGrasp`, and also how far the thumb's curl plane was turned to reach the object (0 when it was not). */
export function solveGraspFull(hand: HandModel, obstacles: readonly Primitive[], relaxed: readonly number[]): { bends: number[]; thumbSwing: number } {
	if (obstacles.length === 0) return { bends: [...relaxed], thumbSwing: 0 };
	let thumbSwing = 0;
	const bends = hand.flatMap((finger, i) => {
		const grasp = i === 0 ? solveThumb(finger, obstacles) : { ...solveFinger(finger, obstacles), swing: 0 };
		if (i === 0 && grasp.touched) thumbSwing = grasp.swing;
		return grasp.touched ? grasp.bends : relaxed.slice(i * 3, i * 3 + 3);
	});
	return { bends, thumbSwing };
}

/** Rotates a vector about an axis (Rodrigues). */
function rotateAbout(v: V3, axis: V3, angle: number): V3 {
	const k = normalize(axis);
	const c = Math.cos(angle), s = Math.sin(angle);
	const kv = cross(k, v);
	const d = dot(k, v) * (1 - c);
	return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The same finger, but curling in a plane turned by `swing` radians about the finger's own direction. */
export function withSwing(finger: FingerModel, swing: number): FingerModel {
	return swing === 0 ? finger : { ...finger, palm: rotateAbout(finger.palm, finger.direction, swing) };
}

/**
 * A thumb does not just curl: it turns across the palm to press against the object opposite the fingers. So it is tried in
 * several curl planes, from its natural one outwards, and the first that ends up touching the object wins. `swing` is how far
 * that plane was turned, which whoever draws the thumb applies to its own curl axis.
 */
export function solveThumb(thumb: FingerModel, obstacles: readonly Primitive[]): FingerGrasp & { swing: number } {
	for (const swing of [0, 0.5, -0.5, 1, -1, 1.5]) {
		const grasp = solveFinger(withSwing(thumb, swing), obstacles);
		if (grasp.touched) return { ...grasp, swing };
	}
	return { ...solveFinger(thumb, obstacles), touched: false, swing: 0 };
}

/** How a hand looks when it is just holding something, before any object is considered. */
export const HOLDING_CURLS: Curls = [0.65, 0.6, 0.75, 0.75, 0.7];
export const holdingBends = (): number[] => bendsFromCurls(HOLDING_CURLS);

/** A typical adult hand, for the Studio's preview and for avatars whose fingers cannot be measured. */
export function defaultHandModel(side: 'left' | 'right'): HandModel {
	const toThumb = side === 'right' ? -1 : 1; // which side of the hand the thumb is on
	const maxFinger: [number, number, number] = [JOINT_BEND.index[0] * 1.25, JOINT_BEND.index[1] * 1.15, JOINT_BEND.index[2] * 1.35];
	const finger = (x: number, z: number, lengths: [number, number, number]): FingerModel => ({
		base: [toThumb * x, 0, z], direction: [0, 0, 1], palm: [0, -1, 0], lengths, radius: 0.009, maxBend: maxFinger
	});
	const thumb: FingerModel = {
		base: [toThumb * 0.035, -0.012, 0.03],
		direction: normalize([toThumb * 0.45, -0.15, 0.88]),
		palm: normalize([-toThumb * 0.6, -0.8, 0.2]),
		lengths: [0.035, 0.03, 0.026],
		radius: 0.01,
		maxBend: [1.0, 1.2, 1.3]
	};
	return [
		thumb,
		finger(0.03, 0.09, [0.04, 0.025, 0.022]),
		finger(0.01, 0.095, [0.044, 0.028, 0.024]),
		finger(-0.01, 0.09, [0.04, 0.026, 0.022]),
		finger(-0.03, 0.08, [0.032, 0.02, 0.02])
	];
}

export { FINGER_NAMES };
