import type { Vec3 } from '../ecs/types.ts';
import type { SceneColliders } from './sceneColliders.ts';

/** What the script's physics needs of the scene's colliders: the collision world as it is now. */
type ColliderSource = Pick<SceneColliders, 'sync'>;

/** What a script gets back from a ray or a sweep: the slot it touched, how far along, where, and the way out of the surface. */
export interface PhysicsHit {
	slotId: string;
	t: number;
	point: Vec3;
	normal: Vec3;
}

/** A solid a sphere is inside of or touching: the slot, the way to push the sphere out along and how deep it is. */
export interface PhysicsContact {
	slotId: string;
	normal: Vec3;
	depth: number;
	point: Vec3;
}

export interface PhysicsQueryOptions {
	/** Slots to pass through, with everything under them (a body's own parts, what it holds). */
	ignore?: string[];
}

/** The questions a script can ask of the solids of the world (`ctx.physics`): synchronous, and answered from the colliders as they are now. */
export interface ScriptPhysics {
	/** The first solid a ray meets within `maxDistance` metres; null when it meets none. */
	raycast(origin: Vec3, direction: Vec3, maxDistance: number, options?: PhysicsQueryOptions): PhysicsHit | null;
	/** Moves a sphere of `radius` along `direction` and says where it first touches a solid (`t` is the distance moved); a sphere already inside one that it moves into is a hit at 0. */
	sphereCast(origin: Vec3, radius: number, direction: Vec3, maxDistance: number, options?: PhysicsQueryOptions): PhysicsHit | null;
	/** Every solid a sphere is inside of or touching, deepest first (at most 32). */
	overlapSphere(center: Vec3, radius: number, options?: PhysicsQueryOptions): PhysicsContact[];
	/** The solid nearest to a point within `maxDistance` (the point's own if it is inside one), or null. */
	closest(point: Vec3, maxDistance?: number, options?: PhysicsQueryOptions): (PhysicsContact & { distance: number }) | null;
}

const MAX_DISTANCE = 2000;
const MAX_RADIUS = 100;
const MAX_CONTACTS = 32;

const vec = (value: unknown): Vec3 | null =>
	Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? ([value[0], value[1], value[2]] as Vec3) : null;
const num = (value: unknown, max: number): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null);

/**
 * Builds `ctx.physics` over a scene's colliders. `parentOf` gives the parent of a slot so that ignoring a slot ignores what is under it.
 * Bad arguments (not three finite numbers, a negative distance) answer as nothing found, like a ray that hits nothing: a script's
 * mistake must not throw into the middle of a frame.
 */
export function createScriptPhysics(colliders: ColliderSource, parentOf: (slotId: string) => string | null): ScriptPhysics {
	const ignoring = (options?: PhysicsQueryOptions) => {
		const ids = Array.isArray(options?.ignore) ? new Set(options!.ignore.filter((id): id is string => typeof id === 'string')) : null;
		if (!ids || ids.size === 0) return undefined;
		return (id: string): boolean => {
			for (let current: string | null = id, guard = 0; current && guard < 64; current = parentOf(current), guard++) if (ids.has(current)) return true;
			return false;
		};
	};
	return {
		raycast(origin, direction, maxDistance, options) {
			const o = vec(origin), d = vec(direction), max = num(maxDistance, MAX_DISTANCE);
			if (!o || !d || max === null || (d[0] === 0 && d[1] === 0 && d[2] === 0)) return null;
			const hit = colliders.sync().raycast(o, d, max, { ignore: ignoring(options) });
			return hit ? { slotId: hit.id, t: hit.t, point: hit.point, normal: hit.normal } : null;
		},
		sphereCast(origin, radius, direction, maxDistance, options) {
			const o = vec(origin), d = vec(direction), r = num(radius, MAX_RADIUS), max = num(maxDistance, MAX_DISTANCE);
			if (!o || !d || r === null || max === null || (d[0] === 0 && d[1] === 0 && d[2] === 0)) return null;
			const hit = colliders.sync().sphereCast(o, r, d, max, { ignore: ignoring(options) });
			return hit ? { slotId: hit.id, t: hit.t, point: hit.point, normal: hit.normal } : null;
		},
		overlapSphere(center, radius, options) {
			const c = vec(center), r = num(radius, MAX_RADIUS);
			if (!c || r === null) return [];
			return colliders.sync().overlapSphere(c, r, { ignore: ignoring(options) }).slice(0, MAX_CONTACTS).map((contact) => ({ slotId: contact.id, normal: contact.normal, depth: contact.depth, point: contact.point }));
		},
		closest(point, maxDistance, options) {
			const p = vec(point), max = maxDistance === undefined ? Infinity : num(maxDistance, MAX_DISTANCE);
			if (!p || max === null) return null;
			const found = colliders.sync().closest(p, max, { ignore: ignoring(options) });
			return found ? { slotId: found.id, normal: found.normal, depth: found.depth, point: found.point, distance: found.distance } : null;
		}
	};
}
