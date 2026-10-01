import { Mesh, ReflectionProbe, type Scene, type Vector3 } from '@babylonjs/core';
import { importAsset } from '$lib/assets/importAsset';
import { getLocalAssetStore } from '$lib/assets/store';
import type { AssetId } from '$lib/assets/ref';
import { flipRows } from './thumbnail/cubeToEquirect';

export type ProbeFaces = Record<'Px' | 'Nx' | 'Py' | 'Ny' | 'Pz' | 'Nz', AssetId>;
// Babylon reads cubemap targets in GL order; CubeTexture.CreateFromImages uses this same order.
const DIRECTIONS = ['Px', 'Py', 'Pz', 'Nx', 'Ny', 'Nz'] as const;
const SIZE = 128;

function pngBytes(pixels: Uint8Array): Promise<Uint8Array> {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas is unavailable.');
	context.putImageData(new ImageData(new Uint8ClampedArray(pixels) as ImageDataArray, SIZE, SIZE), 0, 0);
	return new Promise((resolve, reject) => canvas.toBlob(async (blob) => {
		if (!blob) { reject(new Error('Could not encode the probe image.')); return; }
		resolve(new Uint8Array(await blob.arrayBuffer()));
	}, 'image/png'));
}

/** Captures one cubemap at a world position, then stores its faces as normal image assets. */
export async function bakeReflectionProbe(scene: Scene, position: Vector3, name: string): Promise<ProbeFaces> {
	await scene.whenReadyAsync();
	const previousEnvironment = scene.environmentTexture;
	const probe = new ReflectionProbe('baking-reflection-probe', SIZE, scene);
	try {
		probe.position.copyFrom(position);
		probe.renderList = scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.isVisible && mesh.name !== 'studio-ground' && !mesh.name.startsWith('inspector-'));
		// Avoid sampling the environment being replaced while capturing the new one.
		scene.environmentTexture = null;
		scene.incrementRenderId();
		probe.cubeTexture.render();
		const faces = {} as ProbeFaces;
		for (let index = 0; index < DIRECTIONS.length; index++) {
			const pixels = await probe.cubeTexture.readPixels(index, 0, null, true, true);
			if (!pixels || pixels.byteLength !== SIZE * SIZE * 4) throw new Error(`Could not read probe face ${DIRECTIONS[index]}.`);
			const rgba = flipRows(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), SIZE);
			const bytes = await pngBytes(rgba);
			const result = await importAsset(bytes, `${name}-${DIRECTIONS[index]}.png`, getLocalAssetStore(), { type: 'image' });
			faces[DIRECTIONS[index]] = result.manifest.assetId;
		}
		return faces;
	} finally {
		scene.environmentTexture = previousEnvironment;
		probe.dispose();
	}
}
