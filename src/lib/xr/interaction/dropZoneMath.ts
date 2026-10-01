import { arcBetween, rotateVector, type Q4, type V3 } from '../avatar/ik.ts';

/**
 * The maths of a `dropZone`: is a released object inside the box, and where does it end up. Plain arrays, no Babylon, so it
 * runs (and is tested) in Node. Same conventions as `avatar/ik`: left-handed, Y up, quaternions as (x, y, z, w) rotating
 * vectors with `rotateVector`.
 */

/** The box in the world: its centre, its orientation and its full size along its own axes. */
export interface ZoneBox {
	center: V3;
	rotation: Q4;
	size: V3;
}

export type DropAlign = 'upright' | 'nearest' | 'keep';

export interface DropOptions {
	align: DropAlign;
	/** Degrees; 0 leaves the turn about the vertical free. */
	yawStep: number;
}

/** What is being put down: where its pivot is, how it is turned, and the corners of its parts in its own frame. */
export interface DroppedObject {
	position: V3;
	rotation: Q4;
	/** Corners of the object's bounding boxes relative to its pivot, in the object's own (unrotated) frame, scale included. */
	localCorners: V3[];
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const conjugate = ([x, y, z, w]: Q4): Q4 => [-x, -y, -z, w];

/** The Hamilton product: `rotateVector(multiply(a, b), v)` is `a` applied to `b` applied to `v`. */
export function multiply(a: Q4, b: Q4): Q4 {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
	];
}

const AXES: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** The corners of an object in the world at a given pose. */
export function worldCorners(object: DroppedObject, position = object.position, rotation = object.rotation): V3[] {
	return object.localCorners.map((corner) => add(position, rotateVector(rotation, corner)));
}

/** The middle of the object's bounds (its pivot when it has no parts). */
export function boundsCenter(object: DroppedObject): V3 {
	const corners = worldCorners(object);
	if (corners.length === 0) return object.position;
	const low: V3 = [Infinity, Infinity, Infinity];
	const high: V3 = [-Infinity, -Infinity, -Infinity];
	for (const corner of corners) for (let axis = 0; axis < 3; axis++) {
		low[axis] = Math.min(low[axis], corner[axis]);
		high[axis] = Math.max(high[axis], corner[axis]);
	}
	return scale(add(low, high), 0.5);
}

/** Whether a point is inside the box. */
export function isInsideZone(zone: ZoneBox, point: V3): boolean {
	const offset = sub(point, zone.center);
	const inverse = conjugate(zone.rotation);
	const local = rotateVector(inverse, offset);
	return Math.abs(local[0]) <= zone.size[0] / 2 && Math.abs(local[1]) <= zone.size[1] / 2 && Math.abs(local[2]) <= zone.size[2] / 2;
}

/** How the object is turned once it lands: its up (or its nearest face) brought onto the box's up, then its turn about it snapped. */
export function alignedRotation(zone: ZoneBox, rotation: Q4, options: DropOptions): Q4 {
	if (options.align === 'keep') return rotation;
	const up = rotateVector(zone.rotation, [0, 1, 0]);
	let result = rotation;

	// The part of the object that ends up pointing at the sky: always its own top, or whichever face is closest to it.
	let skyward: V3 = [0, 1, 0];
	if (options.align === 'nearest') {
		let best = -Infinity;
		for (const axis of AXES) {
			const score = dot(rotateVector(rotation, axis), up);
			if (score > best) { best = score; skyward = axis; }
		}
	}
	result = multiply(arcBetween(rotateVector(result, skyward), up), result);

	if (options.yawStep > 0) {
		// An axis of the object that lies along the ground, measured against the box's own forward.
		const flat = [[1, 0, 0], [0, 0, 1]].map((axis) => rotateVector(result, axis as V3)).sort((a, b) => Math.abs(dot(a, up)) - Math.abs(dot(b, up)))[0];
		const along = sub(flat, scale(up, dot(flat, up)));
		const forward = rotateVector(zone.rotation, [0, 0, 1]);
		const angle = Math.atan2(dot(up, cross(forward, along)), dot(forward, along));
		const step = (options.yawStep * Math.PI) / 180;
		const delta = Math.round(angle / step) * step - angle;
		const half = delta / 2;
		const turn: Q4 = [up[0] * Math.sin(half), up[1] * Math.sin(half), up[2] * Math.sin(half), Math.cos(half)];
		result = multiply(turn, result);
	}
	return result;
}

/**
 * Where an object released inside a zone settles: turned as the zone's options say, and moved along the zone's up direction
 * until its lowest point rests on the zone's floor. It is not moved sideways.
 */
export function settleInZone(zone: ZoneBox, object: DroppedObject, options: DropOptions): { position: V3; rotation: Q4 } {
	const rotation = alignedRotation(zone, object.rotation, options);
	const up = rotateVector(zone.rotation, [0, 1, 0]);
	const floor = dot(zone.center, up) - zone.size[1] / 2;
	const corners = worldCorners(object, object.position, rotation);
	if (corners.length === 0) return { position: object.position, rotation };
	const lowest = Math.min(...corners.map((corner) => dot(corner, up)));
	return { position: add(object.position, scale(up, floor - lowest)), rotation };
}
