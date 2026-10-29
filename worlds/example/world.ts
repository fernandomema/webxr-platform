import { createSlot } from '@kithin/engine/ecs/types';
import type { PackWorld } from '../../src/lib/worldPacks/types.ts';

// The smallest pack: it shows up under Development and exports with `npm run pack -- export example`. Copy it with `npm run pack -- new <id>`.
export default {
	name: 'Pack example',
	description: 'A floor and a spawn point, from the world pack in worlds/example.',
	build: () => [
		createSlot({ id: 'spawn', name: 'Spawn', position: [0, 0, 0], components: [{ type: 'spawnPoint' }] }),
		createSlot({
			id: 'floor',
			name: 'Floor',
			position: [0, -0.05, 0],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#3f3f46' }, { type: 'collider', shape: 'box' }]
		})
	]
} satisfies PackWorld;
