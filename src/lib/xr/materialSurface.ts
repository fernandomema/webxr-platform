import { Color3, PBRMaterial, Texture, VertexBuffer, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { MaterialComponent } from '$lib/ecs/types';
import type { SourceRef } from '$lib/assets/ref';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary';
import { worldUvs, type UvShape } from './materialUv';
import { MATERIAL_MAPS, materialSourceKey, materialSources, type MaterialMap } from './materialSources';

/** One map of one slot: the texture it shows now and what to let go of when it changes or the slot goes. */
interface Held {
	key: string;
	texture: Texture | null;
	release: () => void;
}

interface Surface {
	material: PBRMaterial;
	maps: Partial<Record<MaterialMap, Held>>;
	/** The mesh's own coordinates, kept when they are replaced by ones made from its size, to put back. */
	nativeUvs?: Float32Array;
	/** What the generated coordinates were made for, so they are made again only when it changes. */
	uvKey?: string;
}

const UV_SHAPES = new Set<string>(['box', 'plane', 'ground', 'disc', 'sphere', 'cylinder']);

/**
 * Draws a slot's `material` component on its mesh with a PBR material. Textures from an https address are shared by address
 * (a hundred slots with the same material use one texture, kept while any of them lives); textures that are assets come
 * from the asset library. A map that is still loading, or fails to, leaves the mesh in its plain colour.
 */
export class MaterialSurfaces {
	private surfaces = new Map<string, Surface>();
	private shared = new Map<string, { texture: Texture; users: number }>();

	constructor(
		private scene: Scene,
		private assets?: BlobAssetLibrary
	) {}

	/** Shows `component` on `mesh`, creating the material the first time and updating it after. */
	apply(slotId: string, mesh: AbstractMesh, component: MaterialComponent, color?: string, shape?: string): void {
		// An instance shares its source's material, so it cannot take one of its own: the slot is built as a mesh of its own instead.
		if (mesh.getClassName() === 'InstancedMesh') return;
		let surface = this.surfaces.get(slotId);
		if (!surface) {
			const material = new PBRMaterial(`${slotId}-pbr`, this.scene);
			// Lit by the same lights as everything else and with the same falloff: a world's lights are set for its plain shapes, and
			// with the physical (inverse square) falloff they would barely reach a PBR surface, which would then look flat.
			material.usePhysicalLightFalloff = false;
			// Its own roughness and metallic come from the component, the way the maps are packed from the library.
			material.useRoughnessFromMetallicTextureGreen = true;
			material.useMetallnessFromMetallicTextureBlue = true;
			material.useAmbientOcclusionFromMetallicTextureRed = true;
			// The maps follow the OpenGL convention, and the scene is left-handed.
			material.invertNormalMapX = true;
			material.invertNormalMapY = false;
			surface = { material, maps: {} };
			this.surfaces.set(slotId, surface);
		}
		mesh.material = surface.material;
		this.syncUvs(surface, mesh, component, shape);

		// Tiling belongs to the texture, so slots that repeat the same picture a different number of times each get their own.
		const tiling = component.tiling && component.tiling > 0 ? component.tiling : 1;
		const wanted = materialSources(component);
		for (const name of MATERIAL_MAPS) this.syncMap(surface, name, wanted[name], tiling);

		// The colour map is the colour: the object's own colour would tint it (darker on a dark object). Without one, the colour stands.
		surface.material.albedoColor = wanted.albedo ? Color3.White() : Color3.FromHexString(color ?? '#ffffff');

		const hasArm = !!surface.maps.arm?.texture;
		surface.material.metallic = component.metallic ?? (hasArm ? 1 : 0);
		surface.material.roughness = component.roughness ?? (hasArm ? 1 : 0.7);
	}

	/**
	 * Lays the maps out by real size (`mapping: 'world'`): the mesh's coordinates are made from its position, normals and the
	 * object's scale, so one repeat covers `size` metres on any face, and made again when the object is scaled. Otherwise the
	 * mesh keeps (or gets back) its own coordinates, 0 to 1 across each face, repeated by the textures' tiling.
	 */
	private syncUvs(surface: Surface, mesh: AbstractMesh, component: MaterialComponent, shape?: string): void {
		const world = component.mapping === 'world' && !!shape && UV_SHAPES.has(shape);
		if (!world && !surface.nativeUvs) return;
		mesh.computeWorldMatrix(true);
		const scale = mesh.absoluteScaling;
		const size = component.size && component.size > 0 ? component.size : 1;
		const key = world ? `${shape}|${scale.x.toFixed(4)}|${scale.y.toFixed(4)}|${scale.z.toFixed(4)}|${size}` : 'native';
		if (surface.uvKey === key || (!world && !surface.nativeUvs)) return;
		const uvs = mesh.getVerticesData(VertexBuffer.UVKind);
		if (!world) {
			if (surface.nativeUvs) mesh.setVerticesData(VertexBuffer.UVKind, surface.nativeUvs, true);
			surface.uvKey = key;
			return;
		}
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
		if (!uvs || !positions || !normals) return;
		surface.nativeUvs ??= Float32Array.from(uvs);
		mesh.setVerticesData(VertexBuffer.UVKind, worldUvs(shape as UvShape, positions, normals, surface.nativeUvs, [scale.x, scale.y, scale.z], size), true);
		surface.uvKey = key;
	}

	/** Lets go of everything the slot's material holds. */
	release(slotId: string): void {
		const surface = this.surfaces.get(slotId);
		if (!surface) return;
		for (const name of MATERIAL_MAPS) this.drop(surface, name);
		surface.material.dispose();
		this.surfaces.delete(slotId);
	}

	dispose(): void {
		for (const slotId of [...this.surfaces.keys()]) this.release(slotId);
		for (const { texture } of this.shared.values()) texture.dispose();
		this.shared.clear();
	}

	private syncMap(surface: Surface, name: MaterialMap, source: SourceRef | undefined, tiling: number): void {
		const sourceKey = materialSourceKey(source);
		const key = sourceKey && `${sourceKey}|${tiling}`;
		if (surface.maps[name]?.key === key) return;
		this.drop(surface, name);
		if (!source || !key) return;
		const held: Held = { key, texture: null, release: () => {} };
		surface.maps[name] = held;
		const show = (texture: Texture) => {
			if (surface.maps[name] !== held) return;
			held.texture = texture;
			this.attach(surface.material, name, texture);
		};
		if (source.kind === 'url') {
			const texture = this.acquireShared(key, source.url, tiling);
			held.release = () => this.releaseShared(key);
			show(texture);
		} else if (this.assets) {
			const lease: BlobLease = this.assets.acquire(source.assetId, () => {
				if (lease.state === 'ready' && lease.url && !held.texture) {
					const texture = new Texture(lease.url, this.scene, false, true);
					texture.uScale = tiling;
					texture.vScale = tiling;
					held.release = () => {
						texture.dispose();
						lease.release();
					};
					show(texture);
				}
			});
			held.release = () => lease.release();
		}
	}

	private attach(material: PBRMaterial, name: MaterialMap, texture: Texture | null): void {
		if (name === 'albedo') material.albedoTexture = texture;
		else if (name === 'normal') material.bumpTexture = texture;
		else material.metallicTexture = texture;
	}

	private drop(surface: Surface, name: MaterialMap): void {
		const held = surface.maps[name];
		if (!held) return;
		this.attach(surface.material, name, null);
		held.release();
		delete surface.maps[name];
	}

	private acquireShared(key: string, url: string, tiling: number): Texture {
		const found = this.shared.get(key);
		if (found) {
			found.users += 1;
			return found.texture;
		}
		const texture = new Texture(url, this.scene, false, true, undefined, undefined, () => console.warn(`[material] could not load ${url}`));
		texture.uScale = tiling;
		texture.vScale = tiling;
		this.shared.set(key, { texture, users: 1 });
		return texture;
	}

	private releaseShared(key: string): void {
		const found = this.shared.get(key);
		if (!found) return;
		found.users -= 1;
		if (found.users > 0) return;
		found.texture.dispose();
		this.shared.delete(key);
	}
}

/** The PBR surfaces of a scene's slots that carry a `material` (made by the scene graph the first time one does). */
export function setupMaterialSurfaces(scene: Scene, assets?: BlobAssetLibrary): MaterialSurfaces {
	return new MaterialSurfaces(scene, assets);
}
