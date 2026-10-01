import { Color3, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { findComponent } from '$lib/ecs/types';
import { boxLines, floorCross } from '$lib/studio/dropZoneGeometry';
import type { SceneGraph } from '../sceneGraph';

/**
 * Shows the box of a `dropZone` in the world while it is being worked on: a faint glass box with bright edges and a cross on
 * the floor things settle on. A zone has no mesh of its own, so without this it cannot be seen. It follows the slot every
 * frame, so editing its position, rotation or scale in the inspector moves the box at once.
 *
 * `getSelectedId` answers with the slot to show it for (the one marked in the open inspector), or null for none.
 */
const COLOR = Color3.FromHexString('#34d399');

export function createDropZoneOutline(scene: Scene, sceneGraph: SceneGraph, getSelectedId: () => string | null): { dispose(): void } {
	const root = new TransformNode('drop-zone-outline', scene);
	root.setEnabled(false);

	const glass = new StandardMaterial('drop-zone-outline-glass', scene);
	glass.disableLighting = true;
	glass.diffuseColor = Color3.Black();
	glass.specularColor = Color3.Black();
	glass.emissiveColor = COLOR;
	glass.alpha = 0.16;
	glass.backFaceCulling = false;
	const fill = MeshBuilder.CreateBox('drop-zone-outline-fill', { size: 1 }, scene);
	fill.material = glass;
	fill.parent = root;
	fill.isPickable = false;

	// Drawn in a later group, which clears the depth first, so the edges stay visible when the box is inside a table or a shelf.
	const lines = (name: string, polylines: ReturnType<typeof boxLines>) => {
		const mesh = MeshBuilder.CreateLineSystem(name, { lines: polylines.map((line) => line.map((point) => Vector3.FromArray(point))) }, scene);
		mesh.color = COLOR;
		mesh.parent = root;
		mesh.isPickable = false;
		mesh.renderingGroupId = 1;
		return mesh;
	};
	const edges = lines('drop-zone-outline-edges', boxLines());
	const floor = lines('drop-zone-outline-floor', floorCross());

	const position = new Vector3();
	const rotation = new Quaternion();
	const scale = new Vector3();
	const observer = scene.onBeforeRenderObservable.add(() => {
		const id = getSelectedId();
		const live = id ? sceneGraph.getLive(id) : undefined;
		if (!live || !findComponent(live.slot, 'dropZone')) {
			root.setEnabled(false);
			return;
		}
		live.node.computeWorldMatrix(true);
		live.node.getWorldMatrix().decompose(scale, rotation, position);
		root.position.copyFrom(position);
		root.rotationQuaternion = rotation.clone();
		root.scaling.copyFrom(scale);
		root.setEnabled(true);
	});

	return {
		dispose() {
			scene.onBeforeRenderObservable.remove(observer);
			edges.dispose();
			floor.dispose();
			fill.dispose();
			glass.dispose();
			root.dispose();
		}
	};
}
