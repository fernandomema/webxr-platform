import { add, boundsOf, dot, length, nearest, normalize, rayShape, scale, sub, type Bounds, type Shape, type V3 } from './shapes.ts';

/** One solid of the world: whatever the caller called it, its shape, and the box around it. */
export interface Collider {
	id: string;
	shape: Shape;
	bounds: Bounds;
}

export interface QueryOptions {
	/** Colliders to pass through (a body's own, what it holds). */
	ignore?: (id: string) => boolean;
}

export interface WorldHit {
	id: string;
	/** Distance along the ray or the sweep until the first touch. */
	t: number;
	/** Where the surface was touched, and the way out of it (a unit vector). */
	point: V3;
	normal: V3;
}

/** A shape that overlaps a sphere: the way to push the sphere out along, and how far in it is. */
export interface Contact {
	id: string;
	normal: V3;
	depth: number;
	point: V3;
}

const EPS = 1e-4;
const overlaps = (a: Bounds, b: Bounds, margin = 0): boolean =>
	a.min[0] <= b.max[0] + margin && a.max[0] >= b.min[0] - margin && a.min[1] <= b.max[1] + margin && a.max[1] >= b.min[1] - margin && a.min[2] <= b.max[2] + margin && a.max[2] >= b.min[2] - margin;

/**
 * The solids of a world and the questions a game asks of them: what a ray hits, how far a sphere can go before it touches
 * something, what a sphere is inside of. Shapes are boxes (any turn), spheres and cylinders; nothing here knows about Babylon or
 * about slots, so a script, the player's body and a test all get the same answers.
 */
export class CollisionWorld {
	private readonly items = new Map<string, Collider>();

	get size(): number {
		return this.items.size;
	}

	ids(): string[] {
		return [...this.items.keys()];
	}

	has(id: string): boolean {
		return this.items.has(id);
	}

	get(id: string): Collider | undefined {
		return this.items.get(id);
	}

	/** Adds a solid, or replaces the one with that id (when it moves). */
	set(id: string, shape: Shape): void {
		this.items.set(id, { id, shape, bounds: boundsOf(shape) });
	}

	remove(id: string): void {
		this.items.delete(id);
	}

	clear(): void {
		this.items.clear();
	}

	/** The first solid a ray meets within `maxDistance` (`direction` need not be a unit vector); null when it meets none. */
	raycast(origin: V3, direction: V3, maxDistance: number, options: QueryOptions = {}): WorldHit | null {
		const d = normalize(direction);
		const end = add(origin, scale(d, maxDistance));
		const swept: Bounds = { min: [Math.min(origin[0], end[0]), Math.min(origin[1], end[1]), Math.min(origin[2], end[2])], max: [Math.max(origin[0], end[0]), Math.max(origin[1], end[1]), Math.max(origin[2], end[2])] };
		let best: WorldHit | null = null;
		for (const item of this.items.values()) {
			if (!overlaps(item.bounds, swept) || options.ignore?.(item.id)) continue;
			const hit = rayShape(item.shape, origin, d, best ? best.t : maxDistance);
			if (hit && (!best || hit.t < best.t)) best = { id: item.id, t: hit.t, point: hit.point, normal: hit.normal };
		}
		return best;
	}

	/**
	 * Moves a sphere along `direction` and says where it first touches a solid. A sphere that already overlaps one is a hit at 0, with the
	 * normal to push it out along, as long as it is moving into it. Convex shapes make the distance a convex function of the way along, so each step is the largest that
	 * cannot go through anything, and a sphere moving along a face is not slowed down.
	 */
	sphereCast(origin: V3, radius: number, direction: V3, maxDistance: number, options: QueryOptions = {}): WorldHit | null {
		const d = normalize(direction);
		const end = add(origin, scale(d, maxDistance));
		const swept: Bounds = {
			min: [Math.min(origin[0], end[0]) - radius, Math.min(origin[1], end[1]) - radius, Math.min(origin[2], end[2]) - radius],
			max: [Math.max(origin[0], end[0]) + radius, Math.max(origin[1], end[1]) + radius, Math.max(origin[2], end[2]) + radius]
		};
		const near = [...this.items.values()].filter((item) => overlaps(item.bounds, swept) && !options.ignore?.(item.id));
		let t = 0;
		for (let step = 0; step < 48; step++) {
			const p = add(origin, scale(d, t));
			let advance = Infinity;
			for (const item of near) {
				const n = nearest(item.shape, p);
				const gap = n.distance - radius;
				const approach = -dot(d, n.normal);
				// Touching or inside while moving into it is a hit; moving along or away from it is not (a sphere resting on a floor rolls on).
				if (gap <= EPS) {
					if (approach > 1e-6) return { id: item.id, t, point: n.point, normal: n.normal };
					continue;
				}
				if (approach > 1e-9) advance = Math.min(advance, gap / approach);
			}
			if (advance === Infinity || t + advance > maxDistance) return null;
			t += Math.max(advance, EPS * 0.5);
		}
		return null;
	}

	/** Every solid a sphere is inside of or touching, deepest first. */
	overlapSphere(center: V3, radius: number, options: QueryOptions = {}): Contact[] {
		const around: Bounds = { min: [center[0] - radius, center[1] - radius, center[2] - radius], max: [center[0] + radius, center[1] + radius, center[2] + radius] };
		const found: Contact[] = [];
		for (const item of this.items.values()) {
			if (!overlaps(item.bounds, around) || options.ignore?.(item.id)) continue;
			const n = nearest(item.shape, center);
			if (n.distance < radius) found.push({ id: item.id, normal: n.normal, depth: radius - n.distance, point: n.point });
		}
		return found.sort((a, b) => b.depth - a.depth);
	}

	/** The solid nearest to a point within `maxDistance` (0 when the point is inside one), with where on it and the way out. */
	closest(point: V3, maxDistance = Infinity, options: QueryOptions = {}): (Contact & { distance: number }) | null {
		let best: (Contact & { distance: number }) | null = null;
		for (const item of this.items.values()) {
			if (options.ignore?.(item.id)) continue;
			if (maxDistance < Infinity && !overlaps(item.bounds, { min: point, max: point }, maxDistance)) continue;
			const n = nearest(item.shape, point);
			if (n.distance <= maxDistance && (!best || n.distance < best.distance)) best = { id: item.id, normal: n.normal, depth: Math.max(0, -n.distance), point: n.point, distance: n.distance };
		}
		return best;
	}
}

export { add, length, sub };
