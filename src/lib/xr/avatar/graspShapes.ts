import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { findComponent } from '$lib/ecs/types';
import { normalizeMeshRef } from '$lib/assets/ref';
import type { SceneGraph } from '../sceneGraph';
import type { Primitive } from './grasp';

/**
 * The shapes a hand can wrap around, taken from an object's live slots: boxes, spheres and cylinders as they are, and a
 * model as its bounding box. Expressed in the hand's frame, which is what the grasp solver works in.
 */

/** `handWorld` is the hand frame's world matrix (rotation and translation only). */
export function graspObstacles(sceneGraph: SceneGraph, rootSlotId: string, handWorld: Matrix): Primitive[] {
	const toHand = handWorld.clone().invert();
	const shapes: Primitive[] = [];
	for (const entry of sceneGraph.subtreeOf(rootSlotId)) {
		if (entry.system) continue;
		const mesh = findComponent(entry.slot, 'meshRenderer');
		if (!mesh) continue;
		const ref = normalizeMeshRef(mesh.meshRef);
		let kind: Primitive['kind'] | null = null;
		let world: Matrix | null = null;
		if (ref.kind === 'builtin' && (ref.id === 'box' || ref.id === 'sphere' || ref.id === 'cylinder')) {
			kind = ref.id;
			entry.node.computeWorldMatrix(true);
			world = entry.node.getWorldMatrix();
		} else if (ref.kind === 'asset' && entry.model?.proxy) {
			kind = 'box'; // a model counts as its bounding box
			entry.model.proxy.computeWorldMatrix(true);
			world = entry.model.proxy.getWorldMatrix();
		}
		if (!kind || !world) continue;

		const scaling = new Vector3();
		const rotation = new Quaternion();
		const position = new Vector3();
		world.multiply(toHand).decompose(scaling, rotation, position);
		const size = scaling.asArray().map(Math.abs) as [number, number, number];
		const half: Primitive['half'] =
			kind === 'box' ? [size[0] / 2, size[1] / 2, size[2] / 2]
			: kind === 'sphere' ? [Math.max(...size) / 2, Math.max(...size) / 2, Math.max(...size) / 2]
			: [Math.max(size[0], size[2]) / 2, size[1] / 2, Math.max(size[0], size[2]) / 2];
		shapes.push({ kind, center: position.asArray() as Primitive['center'], rotation: rotation.normalize().asArray() as Primitive['rotation'], half });
	}
	return shapes;
}
