import type { SlotTree } from '../ecs/types.ts';
import { createSlot } from '../ecs/types.ts';

export const BLANK_WORLD_NAME = 'Untitled world';

/** A flat floor and nothing else: the starting point of a world made from scratch, in the Studio or in game. */
export function buildBlankWorld(): SlotTree {
	return [
		createSlot({
			id: 'floor',
			name: 'Floor',
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#4b5563' }, { type: 'collider', shape: 'box' }]
		})
	];
}
