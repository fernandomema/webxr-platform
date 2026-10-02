import type { SlotTree } from '../../ecs/types.ts';

/**
 * What a preview must not run. A thumbnail is a still picture of an object, rendered in a scene of its own, so scripts,
 * sounds, transient effects, live page views and mirrors (which render the whole scene a second time) are left out.
 */
const MIRROR_TINT = '#b6c4d6';
const ACTIVE = new Set<string>(['codeBlock', 'mirror', 'camera', 'audioPlayer', 'htmlView', 'particleBurst', 'impactSound']);

/** A copy of the tree that is safe to load into a throwaway scene: everything that runs or plays is removed; what is drawn stays. */
export function stripActiveComponents(tree: SlotTree): SlotTree {
	return tree.map((slot) => {
		// A mirror without its reflection would be a plain white plane; give it the pale, cool tint of glass instead.
		const wasMirror = slot.components.some((component) => component.type === 'mirror');
		const components = slot.components
			.filter((component) => !ACTIVE.has(component.type))
			.map((component) => (wasMirror && component.type === 'meshRenderer' && !component.color ? { ...component, color: MIRROR_TINT } : component));
		return { ...slot, components };
	});
}
