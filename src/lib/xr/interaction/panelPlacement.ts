import { Vector3, type Camera, type TransformNode } from '@babylonjs/core';

/**
 * Positions `node` in front of `camera` and faces it toward the camera —
 * shared by every toggleable panel (Dash, Inspector, ...) so they open where
 * the user is currently looking instead of a fixed world position.
 */
export function placeInFrontOfCamera(
	node: TransformNode,
	camera: Camera,
	distance: number,
	heightOffset = 0
): void {
	const forward = camera.getForwardRay().direction;
	node.position = camera.globalPosition.add(forward.scale(distance)).add(new Vector3(0, heightOffset, 0));
	// The panel's GUI-textured face is on the plane's -Z side, so a plain
	// lookAt (which points +Z at the target) shows its back — mirrored, since
	// the plane/material renders both sides — hence the 180° yaw.
	node.lookAt(camera.globalPosition, Math.PI);
}
