/**
 * Where to put a camera so an object fills a square picture. Pure: plain arrays.
 */

export type V3 = [number, number, number];

export interface Framing {
	target: V3;
	radius: number;
}

/** Field of view (radians) of the thumbnail camera. */
export const THUMBNAIL_FOV = 0.8;

/** The camera distance that fits the box's bounding sphere in a square view, with a little air round it. */
export function frameBounds(min: V3, max: V3, fov = THUMBNAIL_FOV, margin = 1.15): Framing {
	const target: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
	const half = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
	return { target, radius: Math.max(0.05, (half / Math.sin(fov / 2)) * margin) };
}

/**
 * A head-and-shoulders view of a standing figure: the top half of its bounds, narrowed so outstretched arms
 * (a T-pose) do not shrink the face to a dot.
 */
export function bustBounds(min: V3, max: V3): { min: V3; max: V3 } {
	const height = max[1] - min[1];
	const centreX = (min[0] + max[0]) / 2;
	const centreZ = (min[2] + max[2]) / 2;
	const half = Math.min((max[0] - min[0]) / 2, height * 0.42);
	return {
		min: [centreX - half, min[1] + height * 0.52, centreZ - Math.min((max[2] - min[2]) / 2, half)],
		max: [centreX + half, max[1], centreZ + Math.min((max[2] - min[2]) / 2, half)]
	};
}
