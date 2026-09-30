import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { AssetId } from '$lib/assets/ref';
import type { BlobAssetLibrary } from './blobAssetLibrary';

/**
 * Turns a world orb into a glass globe with the world inside it. The world's 360° preview is painted on the inside of a
 * smaller sphere, so looking into the orb from outside shows the panorama on the far side of it, as if the world were in there.
 * The orb's own sphere stays as the (invisible) thing that is picked and grabbed.
 */

const PANORAMA = { width: 1024, height: 512 };

export function setupWorldGlobe(scene: Scene, orb: AbstractMesh, previewId: AssetId, media: BlobAssetLibrary): { dispose: () => void } {
	const previousVisibility = orb.visibility;
	orb.visibility = 0;

	const glass = new StandardMaterial('world-globe-glass', scene);
	glass.diffuseColor = new Color3(0.8, 0.75, 1);
	glass.specularColor = Color3.White();
	glass.specularPower = 96;
	glass.alpha = 0.14;
	const shell = MeshBuilder.CreateSphere('world-globe-shell', { diameter: 1, segments: 24 }, scene);
	shell.parent = orb;
	shell.material = glass;
	shell.isPickable = false;

	// Until the picture arrives (or if it never does) the inside is a deep violet, like the orb it replaces.
	const inside = new StandardMaterial('world-globe-inside', scene);
	inside.disableLighting = true;
	inside.diffuseColor = Color3.Black();
	inside.specularColor = Color3.Black();
	inside.emissiveColor = Color3.FromHexString('#4c1d95');
	const world = MeshBuilder.CreateSphere('world-globe-world', { diameter: 0.93, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
	world.parent = orb;
	world.material = inside;
	world.isPickable = false;

	let texture: DynamicTexture | null = null;
	let disposed = false;
	let applied = false;
	const lease = media.acquire(previewId, () => void apply());

	async function apply(): Promise<void> {
		if (applied || disposed || lease.state !== 'ready' || !lease.url) return;
		applied = true;
		try {
			const bitmap = await createImageBitmap(await (await fetch(lease.url)).blob());
			if (disposed) return bitmap.close();
			texture = new DynamicTexture('world-globe-panorama', PANORAMA, scene, true);
			texture.getContext().drawImage(bitmap, 0, 0, PANORAMA.width, PANORAMA.height);
			texture.update(false); // a sphere's v axis already runs top to bottom
			bitmap.close();
			// The emissive colour is added to the emissive texture, not multiplied by it, so it has to be black for the picture to show.
			inside.emissiveTexture = texture;
			inside.emissiveColor = Color3.Black();
		} catch {
			applied = false; // try again on the next change
		}
	}
	void apply();

	return {
		dispose() {
			disposed = true;
			lease.release();
			texture?.dispose();
			inside.dispose();
			glass.dispose();
			world.dispose();
			shell.dispose();
			orb.visibility = previousVisibility;
		}
	};
}
