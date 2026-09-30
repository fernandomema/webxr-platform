/**
 * The lines the Studio draws for a Preview camera, in the camera's own space (looking along +Z, head up +Y), like the
 * frustum Unity draws for a camera. Pure: lists of points, one list per line.
 */

export type V3 = [number, number, number];
export type Polyline = V3[];

/** How far in front of the camera the picture's frame is drawn. */
export const FRAME_DISTANCE = 1.2;

/** The four edges from the camera to the corners of the frame, the frame itself, and a small triangle above it marking "up". */
export function frustumLines(fovDegrees: number, distance = FRAME_DISTANCE): Polyline[] {
	const half = Math.tan((Math.min(170, Math.max(5, fovDegrees)) * Math.PI) / 360) * distance;
	const corners: V3[] = [[-half, half, distance], [half, half, distance], [half, -half, distance], [-half, -half, distance]];
	const apex = half * 1.28;
	return [
		...corners.map((corner): Polyline => [[0, 0, 0], corner]),
		[...corners, corners[0]],
		[[-half * 0.22, half, distance], [0, apex, distance], [half * 0.22, half, distance]]
	];
}

/** A small box for the camera's body, so it can be seen and clicked when its frame is out of view. */
export function cameraBodyLines(): Polyline[] {
	const [w, h, front, back] = [0.07, 0.05, 0.05, -0.1];
	const corner = (x: number, y: number, z: number): V3 => [x * w, y * h, z];
	const ring = (z: number): Polyline => [corner(-1, 1, z), corner(1, 1, z), corner(1, -1, z), corner(-1, -1, z), corner(-1, 1, z)];
	return [ring(front), ring(back), ...[[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]): Polyline => [corner(x, y, front), corner(x, y, back)])];
}

/** The side, in CSS pixels, of the live camera view shown in a corner of a viewport of the given size. */
export function insetPixels(width: number, height: number): number {
	return Math.round(Math.max(120, Math.min(260, width * 0.3, height * 0.42)));
}

export const INSET_MARGIN = 12;
