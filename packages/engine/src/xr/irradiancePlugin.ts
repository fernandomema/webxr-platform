import { MaterialPluginBase, RegisterMaterialPlugin, UnregisterMaterialPlugin, type AbstractEngine, type Material, type MaterialDefines, type Scene, type SubMesh, type UniformBuffer } from '@babylonjs/core';
import { FRAGMENT_UNIFORMS, INJECTION_POINTS, MAX_VOLUMES, UNIFORMS, customCode } from './irradianceShader.ts';
import { LightVolumeManager } from './lightVolumeManager.ts';

const NAME = 'IrradianceVolume';

/** The materials baked light is added to: the lit ones. A shader of any other kind (the sky, a mirror) is left alone. */
const MATERIAL_CLASSES = ['StandardMaterial', 'PBRMaterial'];

/**
 * Adds the light of the world's baked volumes to a lit material: it reads the volume at the surface's place, by its normal, and
 * adds that as ambient light. Which volumes there are decides the shader, so the shader is made again when they change.
 */
export class IrradianceVolumePlugin extends MaterialPluginBase {
	constructor(material: Material) {
		super(material, NAME, 200, { IRRADIANCE_VOLUME: false, LV_VERSION: 0 }, true, true);
	}

	override getClassName(): string {
		return 'IrradianceVolumePlugin';
	}

	private manager(scene?: Scene | null): LightVolumeManager | undefined {
		return LightVolumeManager.peek(scene ?? this._material.getScene());
	}

	/** Whether this material draws light at all: self-lit surfaces do not take any. */
	private lit(): boolean {
		const m = this._material as unknown as { disableLighting?: boolean; unlit?: boolean };
		return !m.disableLighting && !m.unlit;
	}

	override prepareDefines(defines: MaterialDefines, scene: Scene): void {
		const manager = this.manager(scene);
		const on = !!manager && manager.texture !== null && manager.layouts.length > 0 && this.lit();
		defines['IRRADIANCE_VOLUME'] = on;
		defines['LV_VERSION'] = on ? manager!.version : 0;
	}

	override getSamplers(samplers: string[]): void {
		samplers.push('lvAtlas');
	}

	override getUniforms(): { ubo: Array<{ name: string; size: number; type: string }>; fragment: string } {
		return { ubo: UNIFORMS.map((name) => ({ name, size: 4, type: 'vec4' })), fragment: FRAGMENT_UNIFORMS };
	}

	override bindForSubMesh(uniformBuffer: UniformBuffer, scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
		const manager = this.manager(scene);
		if (!manager || !manager.texture || !this.lit()) return;
		const rows = manager.uniformValues();
		UNIFORMS.forEach((name, i) => uniformBuffer.updateFloat4(name, rows[i][0], rows[i][1], rows[i][2], rows[i][3]));
		uniformBuffer.setTexture('lvAtlas', manager.texture);
	}

	/**
	 * Babylon asks for this once, when the plugin is added to a material (which is before any volume has loaded), to learn which
	 * points of the shader the plugin writes to, and never again: so the points are always named, with nothing in them until
	 * there is something to add.
	 */
	override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
		if (shaderType !== 'fragment') return null;
		const className = this._material.getClassName();
		const points = (INJECTION_POINTS as Record<string, { definitions: string; code: string }>)[className];
		if (!points) return null;
		const manager = this.manager();
		const code = manager && manager.texture && manager.layouts.length > 0 && this.lit() ? customCode(className, manager.layouts, manager.atlas) : null;
		return code ?? { [points.definitions]: '', [points.code]: '' };
	}
}

/**
 * Makes every lit material that is created from now on carry the plugin. It has to be called before the first material of a
 * scene exists. Without WebGL 2 there are no 3D textures, and nothing is registered.
 */
export function registerIrradiancePlugin(supported = true): void {
	UnregisterMaterialPlugin(NAME);
	if (!supported) return;
	RegisterMaterialPlugin(NAME, (material) => (MATERIAL_CLASSES.includes(material.getClassName()) ? new IrradianceVolumePlugin(material) : null));
}

export { MAX_VOLUMES };
