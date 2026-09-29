import { Color3, Effect, Mesh, MeshBuilder, ShaderMaterial, type Scene, type TransformNode } from '@babylonjs/core';
import type { Slot, SkyboxComponent } from '$lib/ecs/types';

export interface SkyboxBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

const SHADER = 'studioSkybox';

function registerShader(): void {
	if (Effect.ShadersStore[`${SHADER}VertexShader`]) return;
	Effect.ShadersStore[`${SHADER}VertexShader`] = `
		precision highp float;
		attribute vec3 position;
		uniform mat4 worldViewProjection;
		varying vec3 vDir;
		void main() {
			vDir = position;
			gl_Position = worldViewProjection * vec4(position, 1.0);
		}`;
	Effect.ShadersStore[`${SHADER}FragmentShader`] = `
		precision highp float;
		varying vec3 vDir;
		uniform vec3 topColor;
		uniform vec3 horizonColor;
		uniform vec3 bottomColor;
		uniform float stars;
		void main() {
			vec3 d = normalize(vDir);
			float h = d.y;
			vec3 col = h > 0.0
				? mix(horizonColor, topColor, pow(h, 0.55))
				: mix(horizonColor, bottomColor, pow(-h, 0.45));
			// Procedural stars: one candidate per cell of a 3D grid over the view direction.
			vec3 p = d * 140.0;
			vec3 cell = floor(p);
			float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
			float twinkle = 0.6 + 0.4 * fract(r * 91.7);
			float s = step(1.0 - 0.006 * stars, r) * smoothstep(0.32, 0.0, length(fract(p) - 0.5)) * smoothstep(-0.02, 0.25, h);
			col += vec3(s * twinkle);
			gl_FragColor = vec4(col, 1.0);
		}`;
}

/**
 * Renders a `skybox` component as a huge inside-out sphere that follows the
 * camera (`infiniteDistance`), shaded with a top/horizon/bottom gradient and
 * optional procedural stars. Purely visual: it is never picked, grabbed or
 * lit, and costs one draw call.
 */
export function setupSkybox(scene: Scene, _node: TransformNode, initial: SkyboxComponent): SkyboxBinding {
	registerShader();
	const material = new ShaderMaterial(`skybox-mat`, scene, SHADER, {
		attributes: ['position'],
		uniforms: ['worldViewProjection', 'topColor', 'horizonColor', 'bottomColor', 'stars']
	});
	material.backFaceCulling = false;
	material.disableDepthWrite = true;

	const mesh: Mesh = MeshBuilder.CreateSphere('skybox', { diameter: 900, segments: 24 }, scene);
	mesh.material = material;
	mesh.infiniteDistance = true;
	mesh.isPickable = false;
	mesh.applyFog = false;
	mesh.alwaysSelectAsActiveMesh = true;

	function apply(component: SkyboxComponent): void {
		material.setColor3('topColor', Color3.FromHexString(component.topColor || '#0b1030'));
		material.setColor3('horizonColor', Color3.FromHexString(component.horizonColor || '#7c3aed'));
		material.setColor3('bottomColor', Color3.FromHexString(component.bottomColor || '#0f172a'));
		material.setFloat('stars', Math.max(0, Math.min(1, component.stars ?? 0)));
	}
	apply(initial);

	return {
		dispose() {
			mesh.dispose();
			material.dispose();
		},
		sync(slot) {
			const component = slot.components.find((candidate): candidate is SkyboxComponent => candidate.type === 'skybox');
			if (component) apply(component);
		}
	};
}
