import { Matrix, MaterialPluginBase, Vector3, type BaseTexture, type PBRMaterial, type Texture, type UniformBuffer } from '@babylonjs/core';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import {
	TRIPLANAR_DECLARATIONS,
	TRIPLANAR_DEFINITIONS,
	TRIPLANAR_NORMAL_CODE,
	TRIPLANAR_SAMPLER,
	TRIPLANAR_SHARPNESS,
	TRIPLANAR_UNIFORMS,
	edgeOffset,
	repeatsPerMetre
} from './materialTriplanar.ts';

/**
 * Makes a PBR material read its maps by triplanar projection (see `materialTriplanar.ts`). The colour and the
 * occlusion / roughness / metallic maps are the material's own and are read through the projection; the normal map is kept by the
 * plugin (not set on the material), since the material's own way of reading it needs the mesh's coordinates.
 */
export class TriplanarPlugin extends MaterialPluginBase {
	/** Whether the material is read through the projection at all (the shader is the same one otherwise). */
	private active = false;
	private normal: Texture | null = null;
	get enabled(): boolean { return this.active; }
	set enabled(value: boolean) {
		if (value === this.active) return;
		this.active = value;
		this.markAllDefinesAsDirty();
	}

	/** The normal map, blended along the three axes. */
	get normalTexture(): Texture | null { return this.normal; }
	set normalTexture(value: Texture | null) {
		if (!value === !this.normal) { this.normal = value; return; }
		this.normal = value;
		this.markAllDefinesAsDirty();
	}

	/** The metres one repeat covers. */
	size = 1;
	/** How many cells the picture has along one side, when told (see `edgeOffset`); otherwise they are found from the picture. */
	cells: number | null = null;
	/** Where the picture should start at the object's corner, across (u) and up (v), found from the picture itself (see `textureCells.ts`). */
	detectedStart: [number, number] = [0, 0];
	/** Fixed to the object, whether each side is made to hold a whole number of repeats. */
	fit = true;
	/** True when the pattern is fixed to the object rather than to the scene. */
	local = false;
	mesh: AbstractMesh | null = null;
	private rotation = new Matrix();
	private corner = new Vector3();
	private scale = new Vector3(1, 1, 1);

	constructor(material: PBRMaterial) {
		super(material, 'Triplanar', 250, { TRIPLANAR: false, TRIPLANAR_NORMAL: false }, true, true);
	}

	getClassName(): string {
		return 'TriplanarPlugin';
	}

	isCompatible(shaderLanguage: number): boolean {
		return shaderLanguage === 0;
	}

	getUniforms() {
		return { ubo: TRIPLANAR_UNIFORMS.map((uniform) => ({ ...uniform })), fragment: TRIPLANAR_DECLARATIONS };
	}

	getSamplers(samplers: string[]): void {
		samplers.push(TRIPLANAR_SAMPLER);
	}

	getCustomCode(shaderType: string): Record<string, string> | null {
		if (shaderType !== 'fragment') return null;
		return { CUSTOM_FRAGMENT_DEFINITIONS: TRIPLANAR_DEFINITIONS, CUSTOM_FRAGMENT_BEFORE_LIGHTS: TRIPLANAR_NORMAL_CODE };
	}

	prepareDefines(defines: Record<string, unknown>): void {
		defines.TRIPLANAR = this.active;
		defines.TRIPLANAR_NORMAL = this.active && !!this.normal;
	}

	isReadyForSubMesh(_defines: unknown, _scene: Scene): boolean {
		return !this.active || !this.normal || this.normal.isReady();
	}

	hasTexture(texture: BaseTexture): boolean {
		return texture === this.normal;
	}

	getActiveTextures(textures: BaseTexture[]): void {
		if (this.normal) textures.push(this.normal);
	}

	bindForSubMesh(uniformBuffer: UniformBuffer): void {
		const mesh = this.mesh;
		mesh?.absoluteRotationQuaternion.toRotationMatrix(this.rotation);
		// Fixed to the object, the pattern starts at the object's own corner (its lowest point on each axis), so whole tiles meet the edges.
		this.scale.set(1 / this.size, 1 / this.size, 1 / this.size);
		if (mesh && this.local) {
			const box = mesh.getBoundingInfo().boundingBox;
			const extent = box.maximum.subtract(box.minimum).multiply(mesh.absoluteScaling);
			const [x, y, z] = repeatsPerMetre([Math.abs(extent.x), Math.abs(extent.y), Math.abs(extent.z)], this.size, this.fit);
			this.scale.set(x, y, z);
			const corner = box.minimum.multiply(mesh.absoluteScaling);
			Vector3.TransformCoordinatesToRef(corner, this.rotation, this.corner);
			this.corner.addInPlace(mesh.absolutePosition);
		}
		const [startU, startV] = !this.local || !this.fit ? [0, 0] : this.cells ? [edgeOffset(this.cells), edgeOffset(this.cells)] : this.detectedStart;
		uniformBuffer.updateFloat4('triParams', 0, this.local ? 1 : 0, TRIPLANAR_SHARPNESS, startU);
		uniformBuffer.updateFloat4('triOrigin', this.corner.x, this.corner.y, this.corner.z, startV);
		uniformBuffer.updateFloat4('triScale', this.scale.x, this.scale.y, this.scale.z, 0);
		uniformBuffer.updateMatrix('triRot', this.rotation);
		if (this.active && this.normal) uniformBuffer.setTexture(TRIPLANAR_SAMPLER, this.normal);
	}
}
