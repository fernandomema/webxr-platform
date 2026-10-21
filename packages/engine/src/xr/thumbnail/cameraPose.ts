import type { Slot, SlotTree } from '../../ecs/types.ts';
import { quatFromBasis } from '../avatar/fingers.ts';
import { rotateVector, type Q4, type V3 } from '../avatar/ik.ts';

/**
 * Where a "Preview camera" slot really is. Slots are stored relative to their parents, so a camera nested in a group is found by
 * composing the chain from the root. Pure: plain arrays, tested in Node.
 */

export interface Pose {
	position: V3;
	rotation: Q4;
}

/** Hamilton product: applies `b` first and then `a`, like Babylon's `a.multiply(b)`. */
export function multiplyQuat(a: Q4, b: Q4): Q4 {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
	];
}

export const conjugateQuat = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];

const IDENTITY: Pose & { scale: V3 } = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };

function chainTo(tree: readonly Slot[], id: string | null): Slot[] | null {
	const chain: Slot[] = [];
	for (let current = id, hops = 0; current !== null; hops++) {
		const slot = tree.find((candidate) => candidate.id === current);
		if (!slot || hops > 64) return null;
		chain.unshift(slot);
		current = slot.parentId;
	}
	return chain;
}

function compose(chain: readonly Slot[]): Pose & { scale: V3 } {
	let { position, rotation, scale } = IDENTITY;
	for (const slot of chain) {
		const offset = rotateVector(rotation, [slot.position[0] * scale[0], slot.position[1] * scale[1], slot.position[2] * scale[2]]);
		position = [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]];
		rotation = multiplyQuat(rotation, slot.rotation as Q4);
		scale = [scale[0] * slot.scale[0], scale[1] * slot.scale[1], scale[2] * slot.scale[2]];
	}
	return { position, rotation, scale };
}

/** A slot's pose in the world (its parents' positions, rotations and scales applied), or null if it is not in the tree. */
export function worldPose(tree: SlotTree, id: string): Pose | null {
	const chain = chainTo(tree, id);
	if (!chain) return null;
	const { position, rotation } = compose(chain);
	return { position, rotation };
}

/** The pose to store in a slot whose parent is `parentId` so that it ends up at the given world pose. */
export function localPose(tree: SlotTree, parentId: string | null, world: Pose): Pose {
	const chain = parentId === null ? [] : chainTo(tree, parentId);
	const parent = compose(chain ?? []);
	const inverse = conjugateQuat(parent.rotation);
	const offset = rotateVector(inverse, [world.position[0] - parent.position[0], world.position[1] - parent.position[1], world.position[2] - parent.position[2]]);
	return {
		position: [offset[0] / (parent.scale[0] || 1), offset[1] / (parent.scale[1] || 1), offset[2] / (parent.scale[2] || 1)],
		rotation: multiplyQuat(inverse, world.rotation)
	};
}

/**
 * The rotation of a slot that looks along `forward` with its head towards `up` (Babylon: +Z forward, +Y up, left-handed).
 * Built from the three axes; Babylon's own look-direction helper returns the rotation of the view, which is not the same thing.
 */
export function lookRotation(forward: V3, up: V3 = [0, 1, 0]): Q4 {
	const unit = (v: V3): V3 => {
		const l = Math.hypot(v[0], v[1], v[2]) || 1;
		return [v[0] / l, v[1] / l, v[2] / l];
	};
	const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const z = unit(forward);
	let x = cross(up, z);
	// Looking straight up or down leaves no side to speak of; any consistent one will do.
	if (Math.hypot(x[0], x[1], x[2]) < 1e-6) x = cross([0, 0, 1], z);
	x = unit(x);
	return quatFromBasis(x, cross(z, x), z);
}

/** Where a player starts when a world has no spawn point: the engine's default start (2 m in front of the origin, facing +Z). */
export const DEFAULT_SPAWN: Pose = { position: [0, 0, 2], rotation: [0, 0, 0, 1] };

/** The first `spawnPoint` slot of the tree, placed in the world, or null when the world has none. */
export function findSpawnPoint(tree: SlotTree): Pose | null {
	for (const slot of tree) {
		if (!slot.components.some((candidate) => candidate.type === 'spawnPoint')) continue;
		const pose = worldPose(tree, slot.id);
		if (pose) return pose;
	}
	return null;
}

/**
 * What a panorama is taken from for a player starting at `spawn`: the feet position, and the frame the panorama is drawn in. The
 * panorama shows its frame's -Z in the middle (see cubeToEquirect), so the frame is the heading of the spawn (only its turn
 * around the vertical, so the horizon stays level) with a half turn added: the middle of the picture is where the player looks.
 */
export function spawnViewpoint(spawn: Pose): { position: V3; frame: Q4; right: V3 } {
	const forward = rotateVector(spawn.rotation, [0, 0, 1]);
	const yaw = Math.atan2(forward[0], forward[2]);
	const frame: Q4 = [0, Math.sin((yaw + Math.PI) / 2), 0, Math.cos((yaw + Math.PI) / 2)];
	return { position: spawn.position, frame, right: [Math.cos(yaw), 0, -Math.sin(yaw)] };
}

export const DEFAULT_PREVIEW_FOV_DEG = 46;

export interface PreviewCamera extends Pose {
	slotId: string;
	/** Vertical field of view in radians. */
	fov: number;
}

/** The first "Preview camera" in the tree, placed in the world, or null if the author did not set one. */
export function findPreviewCamera(tree: SlotTree): PreviewCamera | null {
	for (const slot of tree) {
		const component = slot.components.find((candidate) => candidate.type === 'previewCamera');
		if (!component || component.type !== 'previewCamera') continue;
		const pose = worldPose(tree, slot.id);
		if (!pose) continue;
		const degrees = Number.isFinite(component.fov) ? Math.min(110, Math.max(15, component.fov as number)) : DEFAULT_PREVIEW_FOV_DEG;
		return { slotId: slot.id, ...pose, fov: (degrees * Math.PI) / 180 };
	}
	return null;
}
