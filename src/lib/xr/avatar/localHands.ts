import { Quaternion, WebXRFeatureName, WebXRHandJoint, type AbstractMesh, type TransformNode, type WebXRDefaultExperience, type WebXRHandTracking, type WebXRInputSource } from '@babylonjs/core';
import type { HandPose } from './defaultAvatar';
import { FULL_BEND, WRIST_BEHIND_GRIP, conjugate, controllerCurls, fistPitch, gripToHandRoll, handFrameFromKnuckles, jointBends, rotateVector, type ButtonState, type Curls } from './fingers';
import type { V3 } from './ik';

/**
 * Reads the local player's hands for the avatar and for presence: where each wrist is, which way the hand
 * faces, and how curled each finger is. Both kinds of input end up in the same shape:
 *  - hand tracking: the frame is worked out from the knuckles, the curls from the finger joints;
 *  - controllers: the frame is the grip frame turned to a hand frame, the curls from the trigger, grip and touch sensors.
 * Rotation is always the world rotation (the rig may have been turned by locomotion), with fingers along +Z and
 * the back of the hand along +Y.
 */

const round = (v: number) => Math.round(v * 100) / 100;

function worldRotation(node: TransformNode): Quaternion {
	const rotation = new Quaternion();
	node.computeWorldMatrix(true);
	node.getWorldMatrix().decompose(undefined, rotation, undefined);
	return rotation.normalize();
}

const J = WebXRHandJoint;
const FINGER_CHAINS: WebXRHandJoint[][] = [
	[J.THUMB_METACARPAL, J.THUMB_PHALANX_PROXIMAL, J.THUMB_PHALANX_DISTAL, J.THUMB_TIP],
	[J.INDEX_FINGER_METACARPAL, J.INDEX_FINGER_PHALANX_PROXIMAL, J.INDEX_FINGER_PHALANX_INTERMEDIATE, J.INDEX_FINGER_PHALANX_DISTAL, J.INDEX_FINGER_TIP],
	[J.MIDDLE_FINGER_METACARPAL, J.MIDDLE_FINGER_PHALANX_PROXIMAL, J.MIDDLE_FINGER_PHALANX_INTERMEDIATE, J.MIDDLE_FINGER_PHALANX_DISTAL, J.MIDDLE_FINGER_TIP],
	[J.RING_FINGER_METACARPAL, J.RING_FINGER_PHALANX_PROXIMAL, J.RING_FINGER_PHALANX_INTERMEDIATE, J.RING_FINGER_PHALANX_DISTAL, J.RING_FINGER_TIP],
	[J.PINKY_FINGER_METACARPAL, J.PINKY_FINGER_PHALANX_PROXIMAL, J.PINKY_FINGER_PHALANX_INTERMEDIATE, J.PINKY_FINGER_PHALANX_DISTAL, J.PINKY_FINGER_TIP]
];

function trackedHand(xr: WebXRDefaultExperience, controller: WebXRInputSource, side: 'left' | 'right'): HandPose | null {
	const tracking = xr.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING) as WebXRHandTracking | undefined;
	const hand = tracking?.getHandByControllerId(controller.uniqueId);
	if (!hand) return null;
	const at = (joint: WebXRHandJoint): V3 | null => {
		const mesh: AbstractMesh | null | undefined = hand.getJointMesh(joint);
		return mesh ? (mesh.absolutePosition.asArray() as V3) : null;
	};
	const wrist = at(J.WRIST);
	const middle = at(J.MIDDLE_FINGER_PHALANX_PROXIMAL);
	const index = at(J.INDEX_FINGER_PHALANX_PROXIMAL);
	const little = at(J.PINKY_FINGER_PHALANX_PROXIMAL);
	if (!wrist || !middle || !index || !little) return null;
	const rotation = handFrameFromKnuckles(wrist, middle, index, little, side);
	if (!rotation) return null;

	// Three joint angles per finger. A thumb's first joint bends against the wrist; a finger's first is the knuckle.
	const bend: number[] = [];
	const curl: number[] = [];
	FINGER_CHAINS.forEach((chain, finger) => {
		const points = [...(finger === 0 ? [wrist] : []), ...chain.map(at)];
		const known = points.every((p): p is V3 => p !== null);
		const angles = known ? jointBends(points as V3[]).slice(0, 3) : [0, 0, 0];
		while (angles.length < 3) angles.push(0);
		bend.push(...angles.map(round));
		curl.push(round(Math.min(1, angles.reduce((a, b) => a + b, 0) / (finger === 0 ? FULL_BEND.thumb : FULL_BEND.finger))));
	});
	// The thumb turns and spreads as well as bends: send where its three segments point, in the hand's frame.
	const thumbPoints = FINGER_CHAINS[0].map(at);
	let thumb: number[] | undefined;
	if (thumbPoints.every((p): p is V3 => p !== null)) {
		const toHand = conjugate(rotation);
		thumb = [];
		for (let i = 0; i < 3; i++) {
			const d = rotateVector(toHand, [thumbPoints[i + 1]![0] - thumbPoints[i]![0], thumbPoints[i + 1]![1] - thumbPoints[i]![1], thumbPoints[i + 1]![2] - thumbPoints[i]![2]]);
			const l = Math.hypot(d[0], d[1], d[2]) || 1;
			thumb.push(round(d[0] / l), round(d[1] / l), round(d[2] / l));
		}
	}
	return { position: wrist, rotation, curl, bend, thumb };
}

function buttonState(button: GamepadButton | undefined): ButtonState | undefined {
	return button ? { value: button.value, touched: button.touched, pressed: button.pressed } : undefined;
}

function controllerHand(controller: WebXRInputSource, side: 'left' | 'right'): HandPose {
	const node = controller.grip ?? controller.pointer;
	const grip = worldRotation(node);
	// grip -> the frame of a hand holding the handle (thumb up) -> the hand frame presence carries (back of the hand up).
	const rotation = grip.multiply(Quaternion.FromArray(fistPitch())).multiply(Quaternion.FromArray(gripToHandRoll(side))).normalize();
	const buttons = controller.inputSource.gamepad?.buttons ?? [];
	// xr-standard mapping: 0 trigger, 1 squeeze, 2 touchpad, 3 thumbstick, 4 and up face buttons and thumb rests.
	const thumb = buttons.slice(2).map(buttonState).filter((b): b is ButtonState => b !== undefined);
	const curl = controllerCurls({ trigger: buttonState(buttons[0]), squeeze: buttonState(buttons[1]), thumb }).map(round) as Curls;
	// The controller is held in the fist; the avatar's hand bone is at the wrist, behind it along the forearm.
	const behind = rotateVector(rotation.asArray() as [number, number, number, number], [0, 0, -WRIST_BEHIND_GRIP]);
	const fist = node.absolutePosition.asArray() as V3;
	return {
		position: [fist[0] + behind[0], fist[1] + behind[1], fist[2] + behind[2]],
		rotation: rotation.asArray() as HandPose['rotation'],
		curl
	};
}

/** The local player's hands right now, keyed by side. Empty outside a headset session. */
export function readHandPoses(xr: WebXRDefaultExperience | null): Partial<Record<'left' | 'right', HandPose>> {
	const hands: Partial<Record<'left' | 'right', HandPose>> = {};
	for (const controller of xr?.input.controllers ?? []) {
		const side = controller.inputSource.handedness;
		if (side !== 'left' && side !== 'right') continue;
		const tracked = controller.inputSource.hand ? trackedHand(xr!, controller, side) : null;
		hands[side] = tracked ?? controllerHand(controller, side);
	}
	return hands;
}
