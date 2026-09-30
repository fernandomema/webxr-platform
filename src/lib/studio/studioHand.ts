import { Color3, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { WRIST_BEHIND_GRIP, fistPitch, gripToHandRoll, rotateVector } from '../xr/avatar/fingers';
import { defaultHandModel, fingerJoints, withSwing, type HandModel } from '../xr/avatar/grasp';
import { arcBetween, type V3 } from '../xr/avatar/ik';

/**
 * A simulated hand for the Studio's "Preview in hand": the palm and five articulated fingers, placed exactly where an
 * avatar's hand sits on a controller grip. Its fingers are drawn from the same model the grasp solver uses, so what the
 * preview shows is what the solver decided.
 */
export interface StudioHand {
	/** The hand frame (wrist at the origin, fingers along +Z), for turning an object's shapes into the solver's space. */
	frame: TransformNode;
	setBends(bends: readonly number[], thumbSwing?: number): void;
	setVisible(visible: boolean): void;
	dispose(): void;
}

export function createStudioHand(scene: Scene, side: 'left' | 'right', grip: TransformNode): StudioHand {
	const frame = new TransformNode(`studio-hand-${side}`, scene);
	frame.parent = grip;
	// grip -> the frame of a hand holding the handle -> the hand frame; then back along the forearm to the wrist.
	const rotation = Quaternion.FromArray(fistPitch()).multiply(Quaternion.FromArray(gripToHandRoll(side)));
	frame.rotationQuaternion = rotation;
	frame.position = Vector3.FromArray(rotateVector(rotation.asArray() as [number, number, number, number], [0, 0, -WRIST_BEHIND_GRIP]));

	const skin = new StandardMaterial(`studio-hand-skin-${side}`, scene);
	skin.diffuseColor = new Color3(0.9, 0.7, 0.55);
	skin.specularColor = Color3.Black();

	const piece = (name: string, size: V3): Mesh => {
		const mesh = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
		mesh.parent = frame;
		mesh.material = skin;
		mesh.isPickable = false;
		return mesh;
	};
	const palm = piece('studio-palm', [0.085, 0.028, 0.09]);
	palm.position.set(0, 0, 0.045);
	const wrist = piece('studio-wrist', [0.06, 0.04, 0.05]);
	wrist.position.set(0, 0, -0.02);

	const model: HandModel = defaultHandModel(side);
	const segments = model.map((finger, i) => finger.lengths.map((length, j) => piece(`studio-finger-${i}-${j}`, [finger.radius * 2, finger.radius * 2, length])));

	return {
		frame,
		setBends(bends, thumbSwing = 0) {
			model.forEach((finger, i) => {
				const joints = fingerJoints(i === 0 ? withSwing(finger, thumbSwing) : finger, bends.slice(i * 3, i * 3 + 3));
				for (let j = 0; j < 3; j++) {
					const a = joints[j], b = joints[j + 1];
					const mesh = segments[i][j];
					mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
					mesh.rotationQuaternion = Quaternion.FromArray(arcBetween([0, 0, 1], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
				}
			});
		},
		setVisible(visible) {
			frame.setEnabled(visible);
		},
		dispose() {
			frame.dispose(false, false);
			skin.dispose();
		}
	};
}
