import type { Component, Slot } from '../ecs/types.ts';
import { meshRefKey, normalizeMeshRef } from '../assets/ref.ts';

/**
 * Whether an edited slot has to be torn down and built again, or can be updated in place. Pure, so it is shared by the
 * host applying an inspector edit and by a guest applying the host's snapshot, and tested without a scene.
 *
 * Most components are plain data that the game reads from the slot when it needs it: changing them needs nothing. Some
 * are turned into something at spawn (a mesh, a surface, a script); for those a change either is applied live by the
 * surface's `sync` or needs a rebuild. The table says which, per component type.
 */

type Construction =
	/** Only these fields are applied live; any other change rebuilds. */
	| { liveKeys: readonly string[] }
	/** Every field is applied live except these, which rebuild. */
	| { rebuildKeys: readonly string[] };

const CONSTRUCTED: Partial<Record<Component['type'], Construction>> = {
	meshRenderer: { liveKeys: ['color'] }, // a different mesh is caught by the visual key
	mirror: { liveKeys: [] },
	camera: { liveKeys: [] },
	audioPlayer: { rebuildKeys: [] },
	htmlView: { rebuildKeys: ['width', 'height', 'interaction', 'pixelRatio'] },
	textDisplay: { rebuildKeys: [] },
	scoreboard: { rebuildKeys: [] },
	surfaceMask: { liveKeys: [] },
	worldPortal: { liveKeys: [] },
	worldLink: { liveKeys: [] },
	uiPanel: { rebuildKeys: ['width', 'height', 'worldWidth'] },
	particleBurst: { liveKeys: [] },
	particleEmitter: { rebuildKeys: ['capacity'] },
	skybox: { rebuildKeys: ['reflectionPreset', 'reflectionCapture', 'reflectionPx', 'reflectionNx', 'reflectionPy', 'reflectionNy', 'reflectionPz', 'reflectionNz', 'toneMapping'] },
	pointLight: { rebuildKeys: [] },
	stroke: { rebuildKeys: [] },
	impactSound: { liveKeys: [] },
	codeBlock: { rebuildKeys: ['code'] },
	avatar: { liveKeys: [] },
	boneAttach: { liveKeys: [] }
};

/** What the slot's mesh is, as far as its node is concerned: a different one means a different node. */
export function visualKey(slot: Slot): string {
	const mesh = slot.components.find((component) => component.type === 'meshRenderer');
	return mesh && mesh.type === 'meshRenderer' ? meshRefKey(normalizeMeshRef(mesh.meshRef)) : 'none';
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function fieldsDiffer(a: Component, b: Component, changed: (key: string) => boolean): boolean {
	const left = a as unknown as Record<string, unknown>;
	const right = b as unknown as Record<string, unknown>;
	for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
		if (key !== 'type' && changed(key) && !same(left[key], right[key])) return true;
	}
	return false;
}

export function needsRebuild(prev: Slot, next: Slot): boolean {
	if (visualKey(prev) !== visualKey(next)) return true;
	// A mesh with a material cannot be an instance of a shared one, so gaining or losing a material is a different mesh.
	// Changes to the material's own fields are applied live.
	if (prev.components.some((c) => c.type === 'material') !== next.components.some((c) => c.type === 'material')) return true;
	// Script state is written by scripts while the world runs: it is never a reason to rebuild.
	const before = prev.components.filter((component) => component.type !== 'scriptState');
	const after = next.components.filter((component) => component.type !== 'scriptState');

	for (const [type, rule] of Object.entries(CONSTRUCTED) as [Component['type'], Construction][]) {
		const a = before.filter((component) => component.type === type);
		const b = after.filter((component) => component.type === type);
		if (a.length !== b.length) return true;
		const rebuilds = 'liveKeys' in rule ? (key: string) => !rule.liveKeys.includes(key) : (key: string) => rule.rebuildKeys.includes(key);
		for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && fieldsDiffer(a[i], b[i], rebuilds)) return true;
	}
	return false;
}
