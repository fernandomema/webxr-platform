import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene, type TransformNode } from '@babylonjs/core';
import type { Slot, StrokeComponent } from '$lib/ecs/types';

export interface StrokeBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

const TESSELLATION = 6;

/**
 * Renders a `stroke` component as ONE tube mesh through its points (world
 * space, flat [x,y,z,...]). A whole brush stroke is a single slot and a single
 * draw call, however long it gets; `sync` rebuilds the tube when points change.
 */
export function setupStroke(scene: Scene, node: TransformNode, initial: StrokeComponent): StrokeBinding {
	const material = new StandardMaterial(`stroke-mat-${node.name}`, scene);
	material.specularColor = Color3.Black();
	let mesh: Mesh | null = null;
	let renderedPoints = -1;
	let renderedWidth = -1;

	function render(component: StrokeComponent): void {
		const color = Color3.FromHexString(component.color || '#ffffff');
		material.diffuseColor = color;
		material.emissiveColor = color.scale(0.55);

		const flat = component.points ?? [];
		const count = Math.floor(flat.length / 3);
		if (count === renderedPoints && component.width === renderedWidth) return;
		renderedPoints = count;
		renderedWidth = component.width;
		mesh?.dispose();
		mesh = null;
		if (count < 2) return;

		const path: Vector3[] = [];
		for (let i = 0; i < count; i++) path.push(new Vector3(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]));
		mesh = MeshBuilder.CreateTube(`${node.name}-tube`, { path, radius: Math.max(0.001, component.width / 2), tessellation: TESSELLATION, cap: Mesh.CAP_ALL }, scene);
		mesh.material = material;
		mesh.isPickable = false;
		mesh.parent = node;
	}

	render(initial);

	return {
		dispose() {
			mesh?.dispose();
			material.dispose();
		},
		sync(slot) {
			const component = slot.components.find((candidate): candidate is StrokeComponent => candidate.type === 'stroke');
			if (component) render(component);
		}
	};
}
