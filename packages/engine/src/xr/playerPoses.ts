import type { Quat, Vec3 } from '../ecs/types.ts';

/** Where a head or a hand is, as the avatar system holds it. */
export interface PoseInput {
	position: Vec3;
	rotation: Quat;
}

/** A pose as a script sees it: the placement plus the three directions it points, so it does not have to do quaternion maths. */
export interface PoseView extends PoseInput {
	/** Unit vectors in world space (local +Z, +Y, +X), like `ctx.hierarchy.getWorldPose`. */
	forward: Vec3;
	up: Vec3;
	right: Vec3;
}

/** The pose of one player: the head always, a hand when it is tracked (a desktop player has no hands). */
export interface PlayerPoseView {
	head: PoseView;
	left?: PoseView;
	right?: PoseView;
}

/** Who is in the world, as a script sees them. `id` is the id `onPlayerReady`, `ctx.storage.player` and trigger events use. */
export interface PlayerSummary {
	id: string;
	name: string;
	role: 'host' | 'guest';
}

/** What `ctx.world.teleportPlayer` accepts: `position` is where the feet go, `yaw` the way to face (radians, 0 looks along +Z). */
export interface TeleportTarget {
	position: Vec3;
	yaw?: number;
}

const LIMIT = 1e5;

/** Rotates `v` by the unit quaternion `q` (x, y, z, w). */
export function rotateVector(q: Quat, v: Vec3): Vec3 {
	const [x, y, z, w] = q;
	// v' = v + 2w(q × v) + 2 q × (q × v)
	const cx = y * v[2] - z * v[1];
	const cy = z * v[0] - x * v[2];
	const cz = x * v[1] - y * v[0];
	return [
		v[0] + 2 * (w * cx + y * cz - z * cy),
		v[1] + 2 * (w * cy + z * cx - x * cz),
		v[2] + 2 * (w * cz + x * cy - y * cx)
	];
}

export function viewPose(pose: PoseInput): PoseView {
	const [x, y, z, w] = pose.rotation;
	const length = Math.hypot(x, y, z, w) || 1;
	const rotation: Quat = [x / length, y / length, z / length, w / length];
	return {
		position: [...pose.position] as Vec3,
		rotation,
		forward: rotateVector(rotation, [0, 0, 1]),
		up: rotateVector(rotation, [0, 1, 0]),
		right: rotateVector(rotation, [1, 0, 0])
	};
}

export function viewPlayerPose(pose: { head: PoseInput; left?: PoseInput; right?: PoseInput }): PlayerPoseView {
	return {
		head: viewPose(pose.head),
		...(pose.left ? { left: viewPose(pose.left) } : {}),
		...(pose.right ? { right: viewPose(pose.right) } : {})
	};
}

/** A teleport target a script gave, checked: a finite position inside the world's limits and a finite yaw. `null` when it is not usable. */
export function parseTeleportTarget(target: unknown): TeleportTarget | null {
	if (!target || typeof target !== 'object') return null;
	const { position, yaw } = target as { position?: unknown; yaw?: unknown };
	if (!Array.isArray(position) || position.length !== 3) return null;
	if (!position.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < LIMIT)) return null;
	if (yaw !== undefined && !(typeof yaw === 'number' && Number.isFinite(yaw))) return null;
	return { position: [position[0], position[1], position[2]], ...(yaw === undefined ? {} : { yaw }) };
}
