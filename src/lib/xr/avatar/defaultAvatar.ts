import { MeshBuilder, StandardMaterial, Color3, Vector3, Quaternion, type Scene, type Mesh } from '@babylonjs/core';

export interface GhostRig {
	head: Mesh;
	leftHand: Mesh;
	rightHand: Mesh;
	setPose(pose: { head: TransformPose; leftHand: TransformPose; rightHand: TransformPose }): void;
	dispose(): void;
}

export interface TransformPose {
	position: [number, number, number];
	rotation: [number, number, number, number];
}

/**
 * Fixed default avatar for every remote peer: no VRM/custom avatar import in
 * v1 (see plan) — just a head box + two hand markers following the XR
 * camera/controller poses broadcast over the network. The local player
 * doesn't need this: Babylon's default XR experience already loads real
 * controller models for the player's own hands.
 */
export function createGhostRig(scene: Scene, color = '#38bdf8'): GhostRig {
	const material = new StandardMaterial('ghost-mat', scene);
	material.diffuseColor = Color3.FromHexString(color);
	material.alpha = 0.85;

	const head = MeshBuilder.CreateBox('ghost-head', { width: 0.22, height: 0.16, depth: 0.2 }, scene);
	const leftHand = MeshBuilder.CreateSphere('ghost-hand-l', { diameter: 0.08 }, scene);
	const rightHand = MeshBuilder.CreateSphere('ghost-hand-r', { diameter: 0.08 }, scene);
	for (const mesh of [head, leftHand, rightHand]) mesh.material = material;

	return {
		head,
		leftHand,
		rightHand,
		setPose({ head: h, leftHand: l, rightHand: r }) {
			head.position = Vector3.FromArray(h.position);
			head.rotationQuaternion = Quaternion.FromArray(h.rotation);
			leftHand.position = Vector3.FromArray(l.position);
			leftHand.rotationQuaternion = Quaternion.FromArray(l.rotation);
			rightHand.position = Vector3.FromArray(r.position);
			rightHand.rotationQuaternion = Quaternion.FromArray(r.rotation);
		},
		dispose() {
			head.dispose();
			leftHand.dispose();
			rightHand.dispose();
			material.dispose();
		}
	};
}
