import { HemisphericLight, type Scene } from '@babylonjs/core';

/**
 * The scene's flat ambient light has two writers: the skybox says how bright the world's ambient is, and baked lighting turns it
 * off while the baked light stands in for it. This keeps both: the skybox sets the base, baked lighting sets a scale.
 */
interface Ambient { base: number; scale: number }
const state = new WeakMap<Scene, Ambient>();

const lightOf = (scene: Scene): HemisphericLight | undefined => scene.lights.find((light): light is HemisphericLight => light instanceof HemisphericLight);

function entryOf(scene: Scene, light: HemisphericLight): Ambient {
	let s = state.get(scene);
	if (!s) { s = { base: light.intensity, scale: 1 }; state.set(scene, s); }
	return s;
}

/** The brightness the world asks of its ambient light. */
export function setAmbientBase(scene: Scene, base: number): void {
	const light = lightOf(scene);
	if (!light) return;
	const s = entryOf(scene, light);
	s.base = base;
	light.intensity = s.base * s.scale;
}

/** How much of it is let through: 1 normally, 0 while baked lighting is in use. */
export function setAmbientScale(scene: Scene, scale: number): void {
	const light = lightOf(scene);
	if (!light) return;
	const s = entryOf(scene, light);
	s.scale = scale;
	light.intensity = s.base * s.scale;
}

/** Forgets what was held for a scene (when the skybox that set it goes). */
export function resetAmbient(scene: Scene, base: number): void {
	const light = lightOf(scene);
	if (!light) return;
	state.set(scene, { base, scale: state.get(scene)?.scale ?? 1 });
	light.intensity = base * (state.get(scene)?.scale ?? 1);
}
