import { Quaternion, type Camera, type Vector3 } from '@babylonjs/core';
import type { TransformPose } from './defaultAvatar.ts';

type Quat = TransformPose['rotation'];

/**
 * Where the camera looks, as a quaternion. A headset's camera keeps one; the desktop camera is turned with Euler angles
 * (yaw and pitch by the mouse) and has none, so its rotation is worked out from them: sending an identity instead made every
 * desktop player face the same way for everyone else.
 */
export function cameraRotation(camera: Camera): Quat {
	const { rotationQuaternion, rotation } = camera as { rotationQuaternion?: Quaternion | null; rotation?: Vector3 };
	if (rotationQuaternion) return rotationQuaternion.asArray() as Quat;
	if (rotation) return Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z).asArray() as Quat;
	return [0, 0, 0, 1];
}

/** The head's pose as sent to the other players and used to drive the avatar. */
export function cameraHeadPose(camera: Camera): TransformPose {
	return { position: camera.globalPosition.asArray() as TransformPose['position'], rotation: cameraRotation(camera) };
}
