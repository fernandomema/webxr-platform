import type { V3 } from './ik.ts';

/**
 * Walking for an avatar whose body is dragged around by the head: each foot stays planted on the floor
 * until the body has moved far enough away from it, then swings to a spot ahead of the body and plants
 * again. The two feet never swing at once, so they alternate on their own. Pure and per foot.
 */

export interface GaitParams {
	/** How far (m) a planted foot may end up from where it belongs under the body before it steps. */
	stepTrigger: number;
	/** Seconds one step takes. */
	stepTime: number;
	/** How high (m) the foot rises mid-step. */
	lift: number;
	/** How much of the body's travel during a step to aim ahead by (1 lands the foot exactly where the body will be). */
	lead: number;
	/** Farther than this (m) the foot is simply put back under the body, as after a teleport. */
	snapDistance: number;
}

export const DEFAULT_GAIT: GaitParams = { stepTrigger: 0.2, stepTime: 0.26, lift: 0.09, lead: 0.7, snapDistance: 1.2 };

export interface Foot {
	/** Where the foot is drawn now. */
	position: V3;
	stepping: boolean;
	from: V3;
	to: V3;
	/** 0 to 1 through the current step. */
	t: number;
}

export const newFoot = (at: V3): Foot => ({ position: [...at], stepping: false, from: [...at], to: [...at], t: 0 });

const horizontal = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Advances one foot by `dt`. `ideal` is where it belongs under the body now and `velocity` the body's horizontal
 * velocity (m/s). `otherStepping` holds the foot back while its partner is in the air. Returns a new foot.
 */
export function stepFoot(foot: Foot, ideal: V3, velocity: V3, otherStepping: boolean, dt: number, params: GaitParams = DEFAULT_GAIT): Foot {
	if (horizontal(foot.stepping ? foot.to : foot.position, ideal) > params.snapDistance) return newFoot(ideal);

	if (foot.stepping) {
		const t = Math.min(1, foot.t + dt / params.stepTime);
		const eased = smooth(t);
		const position: V3 = [
			foot.from[0] + (foot.to[0] - foot.from[0]) * eased,
			foot.from[1] + (foot.to[1] - foot.from[1]) * eased + Math.sin(Math.PI * t) * params.lift,
			foot.from[2] + (foot.to[2] - foot.from[2]) * eased
		];
		return t >= 1 ? newFoot(foot.to) : { ...foot, t, position };
	}

	if (otherStepping || horizontal(foot.position, ideal) <= params.stepTrigger) return { ...foot, position: [foot.position[0], ideal[1], foot.position[2]] };
	const to: V3 = [ideal[0] + velocity[0] * params.stepTime * params.lead, ideal[1], ideal[2] + velocity[2] * params.stepTime * params.lead];
	return { position: foot.position, stepping: true, from: [...foot.position], to, t: 0 };
}

/** Eases a measured velocity so the aimed-for landing spot does not jitter with frame timing. */
export function smoothVelocity(current: V3, previousPosition: V3, position: V3, dt: number, rate = 12): V3 {
	if (dt <= 0) return current;
	const k = 1 - Math.exp(-dt * rate);
	const measured: V3 = [(position[0] - previousPosition[0]) / dt, 0, (position[2] - previousPosition[2]) / dt];
	return [current[0] + (measured[0] - current[0]) * k, 0, current[2] + (measured[2] - current[2]) * k];
}
