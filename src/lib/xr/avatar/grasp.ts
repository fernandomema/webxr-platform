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

/** Where along each segment a finger is checked against obstacles (0 is the joint it starts at, 1 the next one). */
const SAMPLES = [0.25, 0.5, 0.75, 1];

/**
 * The first segment (0 to 2, base to tip) with part of it inside an obstacle, or -1 when the finger is clear. `skipRoot`
 * ignores the first half of the proximal bone: that is where a hand pressed against an object already overlaps it, and it
 * would otherwise veto every way of closing.
 */
function firstContact(finger: FingerModel, bends: readonly number[], obstacles: readonly Primitive[], skipRoot = false): number {
	const joints = fingerJoints(finger, bends);
	for (let segment = 0; segment < 3; segment++) {
		for (const t of SAMPLES) {
			if (skipRoot && segment === 0 && t <= 0.5) continue;
			const point = add(joints[segment], scale(sub(joints[segment + 1], joints[segment]), t));
			for (const shape of obstacles) if (signedDistance(shape, point) < finger.radius) return segment;
		}
	}
	return -1;
}

/** The smallest gap between the finger's surface and an obstacle (negative while they overlap). */
function clearance(finger: FingerModel, bends: readonly number[], obstacles: readonly Primitive[]): number {
	const joints = fingerJoints(finger, bends);
	let gap = Infinity;
	for (let segment = 0; segment < 3; segment++) {
		for (const t of SAMPLES) {
			const point = add(joints[segment], scale(sub(joints[segment + 1], joints[segment]), t));
			for (const shape of obstacles) gap = Math.min(gap, signedDistance(shape, point) - finger.radius);
		}
	}
	return gap;
}

export interface FingerGrasp {
	bends: [number, number, number];
	/** False when the finger closed all the way without meeting the object (it is out of reach). */
	touched: boolean;
}

const CONTACT_GAP = 0.006;

/**
 * How fast each joint closes against the others (knuckle, middle, tip). A real finger bends all three together, the middle
 * joint a little ahead and the tip behind; closing one joint at a time instead ends in a hook.
 */
const FINGER_RATES: [number, number, number] = [1, 1.1, 0.75];
/** The thumb's first joint is set by the search (opposition); the other two close together. */
const THUMB_RATES: [number, number, number] = [0, 1, 0.9];

interface CloseOptions {
	from?: readonly number[];
	limit?: readonly number[];
	rates?: readonly number[];
	skipRoot?: boolean;
	step?: number;
}

/**
 * Closes a finger the way it wraps round a handle: every joint at once, each at its own rate, until `limit`. When a segment
 * meets the object, the joints behind it stop (they cannot press further) while the ones beyond it keep closing, so the
 * finger folds round the shape. Each contact is approached in shrinking steps so the finger ends up on the surface.
 */
function closeFinger(finger: FingerModel, obstacles: readonly Primitive[], options: CloseOptions = {}): FingerGrasp {
	const { limit = finger.maxBend, rates = FINGER_RATES, skipRoot = false, step = 0.04 } = options;
	let bends = [...(options.from ?? [0, 0, 0])] as [number, number, number];
	const moving = bends.map((b, j) => rates[j] > 0 && b < limit[j]);
	let touched = false;
	const advance = (k: number) => bends.map((b, j) => (moving[j] ? Math.min(limit[j], b + step * rates[j] * k) : b)) as [number, number, number];
	while (moving.some(Boolean)) {
		const trial = advance(1);
		const hit = firstContact(finger, trial, obstacles, skipRoot);
		if (hit < 0) {
			bends = trial;
			bends.forEach((b, j) => (moving[j] &&= b < limit[j] - 1e-9));
			continue;
		}
		touched = true;
		let free = 0, blocked = 1;
		for (let i = 0; i < 5; i++) {
			const mid = (free + blocked) / 2;
			if (firstContact(finger, advance(mid), obstacles, skipRoot) < 0) free = mid;
			else blocked = mid;
		}
		bends = advance(free);
		// Only the joints up to the segment that hit move it; the segments beyond can still close.
		for (let j = 0; j <= hit; j++) moving[j] = false;
	}
	return { bends, touched };
}

/**
 * Closes a finger onto an obstacle. When the straight finger already overlaps it (the hand was placed with the knuckles
 * against the object) it still closes, ignoring the overlapping root. A finger buried in the object has nothing to wrap.
 */
export function solveFinger(finger: FingerModel, obstacles: readonly Primitive[], step = 0.04): FingerGrasp {
	if (firstContact(finger, [0, 0, 0], obstacles) < 0) return closeFinger(finger, obstacles, { step });
	if (firstContact(finger, [0, 0, 0], obstacles, true) < 0) return closeFinger(finger, obstacles, { step, skipRoot: true });
	return { bends: [0, 0, 0], touched: false };
}

/** A finger that does not reach the object rests at `relaxed`, or stops short of it where the object is in the way. */
function relaxFinger(finger: FingerModel, obstacles: readonly Primitive[], relaxed: readonly number[]): number[] {
	if (firstContact(finger, relaxed, obstacles, true) < 0 || firstContact(finger, [0, 0, 0], obstacles, true) >= 0) return [...relaxed];
	const top = Math.max(...relaxed);
	return closeFinger(finger, obstacles, { limit: relaxed, rates: relaxed.map((b) => b / top), skipRoot: true }).bends;
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
	// The fingers first: the thumb then presses against the object opposite wherever they ended up.
	const fingers = hand.map((finger, i) => (i === 0 ? null : solveFinger(finger, obstacles)));
	const tips: V3[] = [];
	fingers.forEach((grasp, i) => {
		if (grasp?.touched) tips.push(fingerJoints(hand[i], grasp.bends)[3]);
	});
	const opposite = tips.length ? scale(tips.reduce(add, [0, 0, 0] as V3), 1 / tips.length) : null;
	const thumb = solveThumb(hand[0], obstacles, opposite);
	const bends = hand.flatMap((finger, i) => {
		const grasp = i === 0 ? thumb : fingers[i]!;
		return grasp.touched ? grasp.bends : relaxFinger(finger, obstacles, relaxed.slice(i * 3, i * 3 + 3));
	});
	return { bends, thumbSwing: thumb.touched ? thumb.swing : 0 };
}

/** The obstacles as seen from a hand moved by `shift` (in its own frame). */
export function shiftPrimitives(obstacles: readonly Primitive[], shift: V3): Primitive[] {
	return obstacles.map((shape) => ({ ...shape, center: sub(shape.center, shift) }));
}

const PALM_GAP = 0.003;

/**
 * The palm and the open fingers over it, as spheres in the hand frame. The fingers' first two bones count so that they
 * start out clear of the object and have something to close round; the tips are left out, they curl out of the way.
 */
function palmSpheres(hand: HandModel): { center: V3; radius: number }[] {
	return hand.slice(1).flatMap((finger) => {
		const b = finger.base;
		const d = normalize(finger.direction);
		const [l0, l1] = finger.lengths;
		return [
			{ center: b, radius: finger.radius * 1.3 },
			...[0.35, 0.7].map((f) => ({ center: [b[0] * (0.7 + 0.3 * f), b[1], b[2] * f] as V3, radius: finger.radius * 1.6 })),
			...[0.5 * l0, l0, l0 + 0.5 * l1, l0 + l1].map((s) => ({ center: add(b, scale(d, s)), radius: finger.radius }))
		];
	});
}

function palmGap(spheres: { center: V3; radius: number }[], obstacles: readonly Primitive[], shift: V3): number {
	let gap = Infinity;
	for (const sphere of spheres) {
		const point = add(sphere.center, shift);
		for (const shape of obstacles) gap = Math.min(gap, signedDistance(shape, point) - sphere.radius);
	}
	return gap;
}

/** The point of the obstacles' surface nearest to `point`. */
function nearestSurfacePoint(obstacles: readonly Primitive[], point: V3): V3 {
	let nearest = obstacles[0];
	let distance = Infinity;
	for (const shape of obstacles) {
		const d = signedDistance(shape, point);
		if (d < distance) [nearest, distance] = [shape, d];
	}
	const e = 1e-4;
	const gradient = normalize([0, 1, 2].map((axis) => {
		const ahead: V3 = [...point], behind: V3 = [...point];
		ahead[axis] += e;
		behind[axis] -= e;
		return signedDistance(nearest, ahead) - signedDistance(nearest, behind);
	}) as V3);
	return sub(point, scale(gradient, distance));
}

/**
 * How far to move a hand, in its own frame, so that its palm rests on what it holds instead of floating off it or sinking
 * into it. A grabbed object stays where it was caught, so it is the hand that goes to the object: slid across until the
 * nearest part of the object is under the palm, then lowered (or lifted) along the palm's normal until the palm touches it.
 * Null when that takes more than `reach`, e.g. for something held from afar with a laser.
 */
export function palmShift(hand: HandModel, obstacles: readonly Primitive[], reach: number): V3 | null {
	if (obstacles.length === 0 || hand.length < 2) return null;
	const spheres = palmSpheres(hand);
	const bases = hand.slice(1).map((finger) => finger.base);
	const xs = bases.map((b) => b[0]), zs = bases.map((b) => b[2]);
	const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = 0.35 * Math.min(...zs), maxZ = Math.max(...zs);
	const y = bases.reduce((sum, b) => sum + b[1], 0) / bases.length;
	const target = nearestSurfacePoint(obstacles, [(minX + maxX) / 2, y, (minZ + maxZ) / 2]);
	const dx = target[0] - Math.min(maxX, Math.max(minX, target[0]));
	const dz = target[2] - Math.min(maxZ, Math.max(minZ, target[2]));
	const free = (t: number) => palmGap(spheres, obstacles, [dx, t, dz]) >= PALM_GAP;
	// Come down from above until the palm meets the object, so it lands on the side of the object facing it.
	let above = reach;
	if (!free(above)) return null;
	let below = NaN;
	const step = reach / 50;
	for (let t = reach - step; t >= -reach - 1e-9; t -= step) {
		if (!free(t)) {
			below = t;
			break;
		}
		above = t;
	}
	if (Number.isNaN(below)) return null;
	for (let i = 0; i < 12; i++) {
		const mid = (above + below) / 2;
		if (free(mid)) above = mid;
		else below = mid;
	}
	const shift: V3 = [dx, above, dz];
	return Math.hypot(...shift) <= reach ? shift : null;
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
 * A thumb does not move like a finger. Its metacarpal swings across the palm (opposition) before the other two joints flex,
 * and it meets the object from the side opposite the fingers. So the search is: for each way of turning the curl plane
 * (`swing`) and each opposition angle, the two outer joints close together until contact, the way a finger's do. Of the
 * resulting poses that touch without entering, the one whose pad lands nearest `opposite` (the fingertips' centre) wins;
 * smaller turns break ties, so the thumb does not twist further than it needs to. `swing` is how far the plane was
 * turned, which whoever draws the thumb applies to its curl plane.
 */
export function solveThumb(thumb: FingerModel, obstacles: readonly Primitive[], opposite: V3 | null = null): FingerGrasp & { swing: number } {
	const size = thumb.lengths[0] + thumb.lengths[1] + thumb.lengths[2];
	const target: V3 = opposite ?? add(thumb.base, [-thumb.base[0], -0.33 * size, 0.44 * size]);
	let best: (FingerGrasp & { swing: number }) | null = null;
	let bestScore = Infinity;
	for (let swing = -0.75; swing <= 0.75 + 1e-9; swing += 0.25) {
		const turned = withSwing(thumb, swing);
		// A negative opposition opens the thumb away from the palm, round an object pressed into it.
		for (let opposition = -0.5; opposition <= thumb.maxBend[0] + 1e-9; opposition += 0.1) {
			if (firstContact(turned, [opposition, 0, 0], obstacles, true) >= 0) continue;
			const grasp = closeFinger(turned, obstacles, { from: [opposition, 0, 0], rates: THUMB_RATES, skipRoot: true });
			if (!grasp.touched || clearance(turned, grasp.bends, obstacles) > CONTACT_GAP) continue;
			const [, , p2, p3] = fingerJoints(turned, grasp.bends);
			const pad: V3 = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2, (p2[2] + p3[2]) / 2];
			const score = Math.hypot(pad[0] - target[0], pad[1] - target[1], pad[2] - target[2]) + 0.1 * size * (Math.abs(swing) + 0.3 * Math.abs(opposition));
			if (score < bestScore) {
				bestScore = score;
				best = { ...grasp, swing };
			}
		}
	}
	return best ?? { bends: [0, 0, 0], touched: false, swing: 0 };
}

/** How a hand looks when it is just holding something, before any object is considered. */
export const HOLDING_CURLS: Curls = [0.65, 0.6, 0.75, 0.75, 0.7];
export const holdingBends = (): number[] => bendsFromCurls(HOLDING_CURLS);

/** A typical adult hand, for the Studio's preview and for avatars whose fingers cannot be measured. */
export function defaultHandModel(side: 'left' | 'right'): HandModel {
	const toThumb = side === 'right' ? -1 : 1; // which side of the hand the thumb is on
	const maxFinger: [number, number, number] = [JOINT_BEND.index[0] * 1.15, JOINT_BEND.index[1] * 1.1, JOINT_BEND.index[2] * 1.2];
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
