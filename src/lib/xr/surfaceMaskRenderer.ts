import { Color3, DynamicTexture, MeshBuilder, Quaternion, StandardMaterial, Vector3, Vector4, type Mesh, type Scene, type AbstractMesh } from '@babylonjs/core';
import type { SurfaceMaskComponent, Slot } from '$lib/ecs/types';
import type { MeshRef } from '$lib/assets/ref';

export interface SurfaceMaskBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

/** A box's 6 faces default to sharing the SAME 0-1 UV square (see Babylon's boxBuilder), so a coating painted through raw UV alone would land identically on every face. Laying the mask out as a 3x2 atlas — one cell per face — gives each face its own paintable region instead. Not needed for other primitives: their UV is already a single continuous, non-repeating region. */
const ATLAS_COLS = 3;
const ATLAS_ROWS = 2;

/** Babylon's box builder order (see CreateBoxVertexData's `normals`): +Z, -Z, +X, -X, +Y, -Y. A script identifying which face a raycast hit (from the hit normal) must use this same order to pick the matching atlas cell — see the "Pressure Washer" lobby tool's `faceIndexFromNormal`. */
function atlasFaceUV(): Vector4[] {
	const faces: Vector4[] = [];
	for (let i = 0; i < 6; i++) {
		const col = i % ATLAS_COLS;
		const row = Math.floor(i / ATLAS_COLS);
		faces.push(new Vector4(col / ATLAS_COLS, row / ATLAS_ROWS, (col + 1) / ATLAS_COLS, (row + 1) / ATLAS_ROWS));
	}
	return faces;
}

function fullCoverageBytes(size: number): Uint8ClampedArray {
	return new Uint8ClampedArray(size).fill(255);
}

function encodeMask(bytes: Uint8ClampedArray): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** `null` when the stored mask doesn't decode to exactly `size` bytes — mismatched/legacy data — so the caller can regenerate a correctly-sized default instead of misreading it. */
function decodeMaskExact(base64: string, size: number): Uint8ClampedArray | null {
	if (typeof atob !== 'function' || !base64) return null;
	try {
		const binary = atob(base64);
		if (binary.length !== size) return null;
		const out = new Uint8ClampedArray(size);
		for (let i = 0; i < size; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

/**
 * Renders a `surfaceMask` component as a translucent tinted coating over the
 * host mesh: an unpickable overlay mesh, nudged out slightly to avoid
 * z-fighting, whose alpha comes from a canvas painted from the component's
 * `mask` bytes. A box gets a 3x2 face atlas (see ATLAS_COLS/ATLAS_ROWS above)
 * so each face paints independently; every other builtin primitive keeps its
 * own natural single-region UV. Generic — any coating driven by this
 * component (grime, frost, paint, snow…) renders through this same function;
 * see ecs/types.ts's SurfaceMaskComponent doc comment and the "Pressure
 * Washer" lobby tool for how a script paints it via `world.raycast` +
 * `world.setComponentField`.
 */
export function setupSurfaceMask(scene: Scene, node: AbstractMesh, initial: SurfaceMaskComponent, meshRef: MeshRef | null): SurfaceMaskBinding {
	const isBox = meshRef?.kind === 'builtin' && meshRef.id === 'box';
	const cols = isBox ? ATLAS_COLS : 1;
	const rows = isBox ? ATLAS_ROWS : 1;
	const cell = Math.max(2, Math.floor(initial.resolution) || 32);
	const width = cell * cols;
	const height = cell * rows;

	const overlay = isBox
		? MeshBuilder.CreateBox(`${node.name}-mask-overlay`, { size: 1, faceUV: atlasFaceUV() }, scene)
		: ((node as Mesh).clone(`${node.name}-mask-overlay`, null, true) as Mesh);
	overlay.parent = node;
	overlay.isPickable = false;
	overlay.metadata = null;
	// clone()/CreateBox both leave (or copy) a local transform that's meaningless
	// here since the overlay is parented directly onto `node` — it must sit
	// exactly on top of it, just a hair larger to avoid z-fighting.
	overlay.position = Vector3.Zero();
	overlay.rotationQuaternion = Quaternion.Identity();
	overlay.scaling = new Vector3(1.012, 1.012, 1.012);

	const texture = new DynamicTexture(`${node.name}-mask-tex`, { width, height }, scene, false);
	texture.hasAlpha = true;
	const material = new StandardMaterial(`${node.name}-mask-mat`, scene);
	material.diffuseTexture = texture;
	material.useAlphaFromDiffuseTexture = true;
	material.specularColor = Color3.Black();
	material.backFaceCulling = true;
	overlay.material = material;

	function paint(component: SurfaceMaskComponent): void {
		let bytes = decodeMaskExact(component.mask, width * height);
		if (!bytes) {
			// First render on this shape (or stale data sized for a different one,
			// e.g. authored before this slot's mesh became a box): reset to a
			// fresh, fully-covered coating at the size this host actually needs,
			// and write it back so every peer converges on the same bytes.
			bytes = fullCoverageBytes(width * height);
			component.mask = encodeMask(bytes);
		}
		const color = Color3.FromHexString(component.color || '#4b3621');
		const r = Math.round(color.r * 255);
		const g = Math.round(color.g * 255);
		const b = Math.round(color.b * 255);
		const opacity = component.opacity ?? 0.9;
		const ctx2d = texture.getContext() as CanvasRenderingContext2D;
		const image = ctx2d.createImageData(width, height);
		for (let i = 0; i < bytes.length; i++) {
			image.data[i * 4] = r;
			image.data[i * 4 + 1] = g;
			image.data[i * 4 + 2] = b;
			image.data[i * 4 + 3] = Math.round(bytes[i] * opacity);
		}
		ctx2d.putImageData(image, 0, 0);
		texture.update(false);
	}

	paint(initial);

	return {
		dispose() {
			overlay.dispose();
			material.dispose();
			texture.dispose();
		},
		sync(slot) {
			const component = slot.components.find((candidate): candidate is SurfaceMaskComponent => candidate.type === 'surfaceMask');
			if (component) paint(component);
		}
	};
}
