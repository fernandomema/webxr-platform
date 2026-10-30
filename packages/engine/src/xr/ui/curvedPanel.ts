import { VertexData, type Mesh } from '@babylonjs/core';

/** How much the dash bends, as the angle (degrees) its width spans around the viewer. 0 is flat. */
export const DASH_CURVES = [
	{ degrees: 0, label: 'Flat' },
	{ degrees: 30, label: 'Slight' },
	{ degrees: 55, label: 'Curved' },
	{ degrees: 80, label: 'Wrapped' }
] as const;
export const DEFAULT_DASH_CURVE = 55;

const SEGMENTS = 48;

export interface CurvedPlaneData {
	positions: number[];
	normals: number[];
	uvs: number[];
	indices: number[];
}

/**
 * A unit plane (1 x 1, in the XY plane) bent around a vertical axis, as a strip of `segments` quads. Its width spans
 * `angle` radians of a circle; `depth` is how far the edges come forward (`frontZ`: the sign of the plane's front
 * normal), in the same unit space as the plane (the mesh's scaling still applies). The edges come toward whoever
 * looks at the front, so the panel wraps around them. Pure.
 *
 * `depthScale` is the radius over the mesh's z scale: with a width of W metres the radius is W / angle, so pass W
 * (the mesh's x scaling) divided by its z scaling. UVs run 0..1 across, as on a plane, so a GUI on it stays aligned.
 */
export function curvedPlaneData(angle: number, frontZ: 1 | -1, depthScale: number, segments = SEGMENTS): CurvedPlaneData {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	const flat = Math.abs(angle) < 1e-4;
	for (let i = 0; i <= segments; i++) {
		const u = i / segments;
		const theta = (u - 0.5) * angle;
		const x = flat ? u - 0.5 : Math.sin(theta) / angle;
		const z = flat ? 0 : (frontZ * depthScale * (1 - Math.cos(theta))) / angle;
		const nx = flat ? 0 : -Math.sin(theta);
		const nz = flat ? frontZ : frontZ * Math.cos(theta);
		for (const v of [0, 1]) {
			positions.push(x, v - 0.5, z);
			normals.push(nx, 0, nz);
			uvs.push(u, v);
		}
	}
	for (let i = 0; i < segments; i++) {
		const a = i * 2; // bottom-left, then top-left, bottom-right, top-right
		const [b, c, d] = [a + 1, a + 2, a + 3];
		// Babylon's own plane: a front facing -z is wound counter-clockwise in XY.
		if (frontZ === -1) indices.push(a, c, b, b, c, d);
		else indices.push(a, b, c, c, b, d);
	}
	return { positions, normals, uvs, indices };
}

/** Bends `mesh` (a unit plane that keeps its scaling) to span `degrees` of a circle; 0 makes it flat again. */
export function curvePanelMesh(mesh: Mesh, degrees: number): void {
	const original = mesh.getVerticesData('normal');
	const frontZ: 1 | -1 = original && original[2] > 0 ? 1 : -1;
	const depthScale = mesh.scaling.x / (mesh.scaling.z || 1);
	const data = curvedPlaneData((degrees * Math.PI) / 180, frontZ, depthScale);
	const vertexData = new VertexData();
	vertexData.positions = data.positions;
	vertexData.normals = data.normals;
	vertexData.uvs = data.uvs;
	vertexData.indices = data.indices;
	vertexData.applyToMesh(mesh);
}

/** The side of a plane mesh its picture is on: the sign of the z of its front normal. */
export function frontSideOf(mesh: Pick<Mesh, 'getVerticesData'>): 1 | -1 {
	const normals = mesh.getVerticesData('normal');
	return normals && normals[2] > 0 ? 1 : -1;
}

/**
 * Where a point of a curved panel is, and which way it faces. `u` and `v` run -0.5..0.5 across and up the panel; `width` and
 * `height` are its size in metres, `angle` the arc its width spans (radians, 0 is flat) and `frontZ` the side it faces. The
 * result is in metres from the panel's centre, `yaw` the turn about the vertical that makes a flat piece lie on the surface.
 * The same shape `curvedPlaneData` gives the panel. Pure.
 */
export function pointOnCurvedPanel(u: number, v: number, width: number, height: number, angle: number, frontZ: 1 | -1): { x: number; y: number; z: number; yaw: number } {
	if (Math.abs(angle) < 1e-4) return { x: u * width, y: v * height, z: 0, yaw: 0 };
	const radius = width / angle;
	const theta = u * angle;
	return { x: radius * Math.sin(theta), y: v * height, z: frontZ * radius * (1 - Math.cos(theta)), yaw: -frontZ * theta };
}

/**
 * The inverse of `pointOnCurvedPanel`: where on the panel (`u`, `v`, each -0.5..0.5 across and up it) a point `x`, `y`, `z` metres
 * from its centre is over, for a point near the panel's surface. `z` is positive towards the side the panel faces (`frontZ`).
 * Null when the point is beside the panel rather than over it. Pure.
 */
export function panelPositionOfPoint(x: number, y: number, z: number, width: number, height: number, angle: number): { u: number; v: number } | null {
	if (Math.abs(angle) < 1e-4) return { u: x / width, v: y / height };
	const radius = width / angle;
	// The panel is an arc of a circle whose centre is `radius` in front of its middle.
	const across = Math.atan2(x, radius - z);
	const u = across / angle;
	return Math.abs(u) <= 0.75 ? { u, v: y / height } : null;
}
