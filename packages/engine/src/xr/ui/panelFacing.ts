/**
 * The turn about the vertical axis that makes a flat panel face `viewer`. A plane's readable side is its -Z side (that is why
 * boards on a wall use a half turn, or `mirrorX`, for people who stand on its +Z side), so it is the direction towards the
 * viewer plus half a turn. Without it the panel shows its back, and its writing is mirrored.
 */
export function yawFacing(panel: { x: number; z: number }, viewer: { x: number; z: number }): number {
	return Math.atan2(viewer.x - panel.x, viewer.z - panel.z) + Math.PI;
}
