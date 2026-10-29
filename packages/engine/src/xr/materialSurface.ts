import { Color3, PBRMaterial, Texture, VertexBuffer, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { MaterialComponent } from '../ecs/types.ts';
import type { SourceRef } from '../assets/ref.ts';
import type { BlobAssetLibrary, BlobLease } from './blobAssetLibrary.ts';
import { worldUvs, type UvShape } from './materialUv.ts';
import { TriplanarPlugin } from './triplanarPlugin.ts';
import { cornerOffset, detectGrid, grayOf, type CellLayout } from './textureCells.ts';

type CellGrid = { u: CellLayout | null; v: CellLayout | null };
import { MATERIAL_MAPS, materialSourceKey, materialSources, type MaterialMap } from './materialSources.ts';

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
	/** Reads the maps by triplanar projection; made the first time the material asks for it. */
	triplanar?: TriplanarPlugin;
	/** The picture whose cells are being, or have been, looked for. */
	analysedUrl?: string;
}

/** Reads a picture at a small size and finds its cells. Needs a browser; answers null when it can not (or there are none). */
async function readCells(url: string): Promise<CellGrid | null> {
	const name = url.startsWith('blob:') ? 'an asset' : url.slice(-48);
	try {
		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.src = url;
		await image.decode();
		const size = 128;
		const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
		const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
		if (!context) return null;
		context.drawImage(image, 0, 0, size, size);
		const grid = detectGrid(grayOf(context.getImageData(0, 0, size, size).data, size * size), size, size);
		const describe = (layout: CellLayout | null) => (layout ? `${layout.cells} cells, corner at ${cornerOffset(layout).toFixed(3)}` : 'no cells');
		console.info(`[material] cells of ${name}: across ${describe(grid.u)}; up ${describe(grid.v)}`);
		return grid;
	} catch (error) {
		console.warn(`[material] could not read ${name} to find its cells: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
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
	private layouts = new Map<string, Promise<CellGrid | null>>();

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
		this.syncTriplanar(surface, mesh, component);

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
	 * `triplanarWorld` and `triplanarLocal` read the maps by projecting them along the three axes, `size` metres per repeat: fixed
	 * in the scene, or fixed to the object. It needs no coordinates from the mesh, so it also suits models and turned objects.
	 */
	private syncTriplanar(surface: Surface, mesh: AbstractMesh, component: MaterialComponent): void {
		const wanted = component.mapping === 'triplanarWorld' || component.mapping === 'triplanarLocal';
		if (!wanted && !surface.triplanar) return;
		if (!surface.triplanar) {
			// A shader that does not compile reports a log as long as the shader: only its first lines are kept.
			surface.material.onError = (_effect, errors) => console.warn(`[material] shader: ${String(errors).slice(0, 600)}`);
			surface.triplanar = new TriplanarPlugin(surface.material);
		}
		const plugin = surface.triplanar;
		const changed = plugin.enabled !== wanted;
		plugin.mesh = mesh;
		plugin.local = component.mapping === 'triplanarLocal';
		plugin.size = component.size && component.size > 0 ? component.size : 1;
		plugin.fit = component.fit !== false;
		plugin.cells = component.cells && component.cells >= 1 ? component.cells : null;
		plugin.enabled = wanted;
		if (changed) this.attach(surface, 'normal', surface.maps.normal?.texture ?? null);
		this.findCells(surface);
	}

	/** Fixed to the object, the picture's cells are found (once per picture) so the edges can cross their middles. */
	private findCells(surface: Surface): void {
		const plugin = surface.triplanar;
		const url = surface.maps.albedo?.texture?.url;
		if (!plugin?.enabled || !plugin.local || plugin.cells || !url || surface.analysedUrl === url) return;
		surface.analysedUrl = url;
		let found = this.layouts.get(url);
		if (!found) this.layouts.set(url, (found = readCells(url)));
		void found.then((grid) => {
			if (surface.triplanar === plugin && surface.analysedUrl === url) plugin.detectedStart = [cornerOffset(grid?.u ?? null), cornerOffset(grid?.v ?? null)];
		});
	}

	/**
	 * Lays the maps out by real size (`mapping: 'world'`): the mesh's coordinates are made from its position, normals and the
	 * object's scale, so one repeat covers `size` metres on any face, and made again when the object is scaled. Otherwise the
	 * mesh keeps (or gets back) its own coordinates, 0 to 1 across each face, repeated by the textures' tiling.
	 */
	private syncUvs(surface: Surface, mesh: AbstractMesh, component: MaterialComponent, shape?: string): void {
		const world = (component.mapping === 'world' || component.mapping === 'wrap' || component.mapping === 'around') && !!shape && UV_SHAPES.has(shape);
		if (!world && !surface.nativeUvs) return;
		mesh.computeWorldMatrix(true);
		const scale = mesh.absoluteScaling;
		const size = component.size && component.size > 0 ? component.size : 1;
		const fit = component.fit !== false;
		const key = world ? `${shape}|${scale.x.toFixed(4)}|${scale.y.toFixed(4)}|${scale.z.toFixed(4)}|${size}|${fit}|${component.mapping}` : 'native';
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
		mesh.setVerticesData(VertexBuffer.UVKind, worldUvs(shape as UvShape, positions, normals, surface.nativeUvs, [scale.x, scale.y, scale.z], size, fit, component.mapping === 'wrap' ? 'top' : component.mapping === 'around' ? 'around' : false), true);
		surface.uvKey = key;
	}

	/** Lets go of everything the slot's material holds. */
	release(slotId: string): void {
		const surface = this.surfaces.get(slotId);
		if (!surface) return;
		for (const name of MATERIAL_MAPS) this.drop(surface, name);
		if (surface.triplanar) surface.triplanar.mesh = null;
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
			this.attach(surface, name, texture);
			if (name === 'albedo') this.findCells(surface);
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

	private attach(surface: Surface, name: MaterialMap, texture: Texture | null): void {
		const material = surface.material;
		if (name === 'albedo') material.albedoTexture = texture;
		else if (name === 'normal') {
			// Projected from three sides, the normal map is read by the plugin; the material's own way needs the mesh's coordinates.
			const projected = !!surface.triplanar?.enabled;
			material.bumpTexture = projected ? null : texture;
			if (surface.triplanar) surface.triplanar.normalTexture = projected ? texture : null;
		}
		else material.metallicTexture = texture;
	}

	private drop(surface: Surface, name: MaterialMap): void {
		const held = surface.maps[name];
		if (!held) return;
		this.attach(surface, name, null);
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
