/**
 * The lines the Studio draws for a Drop zone, in the zone's own space: the unit cube the slot's transform turns into the
 * box, plus a cross on its floor so it is clear which face things come to rest on. Pure: lists of points, one per line.
 */

export type V3 = [number, number, number];
export type Polyline = V3[];

/** The twelve edges of the unit cube centred on the origin. */
export function boxLines(): Polyline[] {
	const h = 0.5;
	const ring = (y: number): Polyline => [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h], [-h, y, -h]];
	return [ring(h), ring(-h), ...[[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]): Polyline => [[x, -h, z], [x, h, z]])];
}

/** Two diagonals across the floor, just above it so they are not lost in the box's own bottom edges. */
export function floorCross(): Polyline[] {
	const h = 0.5;
	const y = -h + 0.002;
	return [[[-h, y, -h], [h, y, h]], [[h, y, -h], [-h, y, h]]];
}
