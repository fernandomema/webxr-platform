import { Color4, Mesh, ParticleSystem, RawTexture, Texture, Vector3, type Scene, type TransformNode } from '@babylonjs/core';
import type { ParticleEmitterComponent, Slot } from '../ecs/types';

const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
	Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

/** Soft radial sprite, generated locally: no texture request or canvas dependency. */
function sprite(scene: Scene): RawTexture {
	const size = 32;
	const pixels = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
		const offset = (y * size + x) * 4;
		pixels.set([255, 255, 255, Math.round(255 * Math.pow(Math.max(0, 1 - radius), 2))], offset);
	}
	const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
	texture.hasAlpha = true;
	return texture;
}

export function setupParticleEmitter(scene: Scene, node: TransformNode, initial: ParticleEmitterComponent) {
	const particles = new ParticleSystem(`emitter-${node.name}`, Math.round(bounded(initial.capacity, 120, 1, 1000)), scene);
	const texture = sprite(scene);
	particles.particleTexture = texture;
	const origin = new Mesh(`emitter-origin-${node.name}`, scene);
	origin.parent = node;
	origin.isPickable = false;
	particles.emitter = origin;
	particles.blendMode = ParticleSystem.BLENDMODE_ADD;
	particles.gravity = new Vector3(0, 0.025, 0);
	let component = initial;
	let emitting = false;
	function apply(next: ParticleEmitterComponent) {
		component = next;
		const color = /^#[\da-f]{6}$/i.test(next.color) ? next.color : '#d4b4ff';
		const tint = Color4.FromHexString(color + 'ff');
		tint.a = bounded(next.opacity, 0.5, 0, 1);
		particles.color1 = tint;
		particles.color2 = new Color4(tint.r * 0.65, tint.g * 0.75, tint.b, tint.a * 0.6);
		particles.colorDead = new Color4(tint.r, tint.g, tint.b, 0);
		particles.createSphereEmitter(bounded(next.radius, 1, 0, 30), 1);
		const size = bounded(next.size, 0.1, 0.01, 5);
		particles.minSize = size * 0.35;
		particles.maxSize = size;
		particles.minLifeTime = bounded(next.lifetime, 5, 0.1, 30) * 0.6;
		particles.maxLifeTime = bounded(next.lifetime, 5, 0.1, 30);
		particles.minEmitPower = bounded(next.speed, 0.12, 0, 10) * 0.4;
		particles.maxEmitPower = bounded(next.speed, 0.12, 0, 10);
		particles.emitRate = bounded(next.rate, 12, 0, 200);
	}
	apply(initial);
	const observer = scene.onBeforeRenderObservable.add(() => {
		const active = component.active !== false && node.isEnabled();
		if (active === emitting) return;
		emitting = active;
		if (active) particles.start();
		else { particles.stop(); particles.reset(); }
	});
	return {
		sync(slot: Slot) {
			const next = slot.components.find((item): item is ParticleEmitterComponent => item.type === 'particleEmitter');
			if (next) apply(next);
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(observer);
			particles.dispose(false);
			texture.dispose();
			origin.dispose();
		}
	};
}
