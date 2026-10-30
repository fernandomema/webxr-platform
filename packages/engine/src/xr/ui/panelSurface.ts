import { Vector3, type AbstractMesh } from '@babylonjs/core';
import { frontSideOf, panelPositionOfPoint } from './curvedPanel.ts';

/**
 * What a mesh a GUI is drawn on says about itself, when it is not a plain plane of its own size: the personal menu is a unit plane
 * scaled to size (so its extent is 1) and may be bent. Without it a mesh is taken as the flat plane its bounds say.
 */
export interface PanelSurfaceInfo {
	/** The mesh is a unit plane scaled to size. */
	unit?: boolean;
	/** How far it is bent, in radians (0 or absent: flat). */
	curve?(): number;
}

const infos = new WeakMap<AbstractMesh, PanelSurfaceInfo>();

export function setPanelSurfaceInfo(mesh: AbstractMesh, info: PanelSurfaceInfo): void {
	infos.set(mesh, info);
}

/**
 * Where on the picture of a GUI mesh a point of the world is over, as `u` (0 left to 1 right) and `v` (0 bottom to 1 top), for a point
 * within `reach` metres of its surface; null otherwise. A bent mesh is read along its arc.
 */
export function panelUvAt(mesh: AbstractMesh, world: Vector3, reach = 0.6): { u: number; v: number } | null {
	mesh.computeWorldMatrix(true);
	const info = infos.get(mesh);
	const scale = mesh.absoluteScaling;
	const bounds = mesh.getBoundingInfo().boundingBox;
	const widthM = (info?.unit ? 1 : bounds.maximum.x - bounds.minimum.x) * scale.x;
	const heightM = (info?.unit ? 1 : bounds.maximum.y - bounds.minimum.y) * scale.y;
	if (!(widthM > 0) || !(heightM > 0)) return null;
	const local = Vector3.TransformCoordinates(world, mesh.getWorldMatrix().clone().invert());
	const front = frontSideOf(mesh as Parameters<typeof frontSideOf>[0]);
	// In metres from the middle of the picture, `z` towards the side it faces.
	const z = local.z * scale.z * front;
	if (Math.abs(z) > reach) return null;
	const over = panelPositionOfPoint(local.x * scale.x, local.y * scale.y, z, widthM, heightM, info?.curve?.() ?? 0);
	return over && { u: over.u + 0.5, v: over.v + 0.5 };
}
