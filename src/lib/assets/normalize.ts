import type { Vec3 } from '../ecs/types';

/**
 * Models are shown scaled so their largest side is 1 unit and centred on the
 * origin, the same contract as the built-in shapes. A slot's own `scale` then
 * sizes them exactly like a primitive.
 */
export function extentsOf(bounds: { min: Vec3; max: Vec3 }): Vec3 {
	return [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
}

/** The extents of the normalised model: largest side 1, the other sides in proportion. Falls back to a unit cube. */
export function normalizedExtents(bounds: { min: Vec3; max: Vec3 } | undefined): Vec3 {
	if (!bounds) return [1, 1, 1];
	const extents = extentsOf(bounds);
	const largest = Math.max(...extents);
	if (!Number.isFinite(largest) || largest <= 1e-9) return [1, 1, 1];
	return [extents[0] / largest, extents[1] / largest, extents[2] / largest].map((v) => Math.max(v, 0.001)) as Vec3;
}

/** Scale and offset that map the given bounds onto the normalised, origin-centred model. */
export function normalizationTransform(bounds: { min: Vec3; max: Vec3 }): { scale: number; offset: Vec3 } {
	const largest = Math.max(...extentsOf(bounds));
	const scale = Number.isFinite(largest) && largest > 1e-9 ? 1 / largest : 1;
	const center: Vec3 = [
		(bounds.min[0] + bounds.max[0]) / 2,
		(bounds.min[1] + bounds.max[1]) / 2,
		(bounds.min[2] + bounds.max[2]) / 2
	];
	return { scale, offset: [-center[0] * scale, -center[1] * scale, -center[2] * scale] };
}
