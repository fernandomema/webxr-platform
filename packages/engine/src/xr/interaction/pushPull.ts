/** How close and how far a laser-held object can be brought or pushed along the laser, in metres from the controller. */
export const PUSH_RANGE = { min: 0.15, max: 15 };
export const STICK_DEADZONE = 0.15;

/**
 * Where along the laser a held object goes this frame: `distance` is where it is now (metres from the controller),
 * `stickY` the stick's forward/back (forward reads negative, and pushes it away). It moves faster the further away it is,
 * so both fine placing close by and sending something across the room are quick. Pure.
 */
export function pushedDistance(distance: number, stickY: number, dt: number): number {
	if (Math.abs(stickY) < STICK_DEADZONE) return distance;
	const speed = 0.5 + Math.max(0, distance) * 1.5;
	return Math.min(PUSH_RANGE.max, Math.max(PUSH_RANGE.min, distance - stickY * speed * dt));
}
