import type { SlotTree } from '$lib/ecs/types';
import { createSlot } from '$lib/ecs/types';
import { buildWishEngine } from '$lib/xr/templates/wishEngine';

export interface StudioTemplate {
	id: string;
	label: string;
	description: string;
	kind: 'object' | 'world';
	defaultName: string;
	build: () => SlotTree;
}

export const TEMPLATES: StudioTemplate[] = [
	{
		id: 'wish-engine',
		label: 'The Wish Engine',
		description: 'An interactive genie cabinet, three rituals and an unfolding celestial observatory.',
		kind: 'world',
		defaultName: 'The Wish Engine',
		build: buildWishEngine
	},
	{
		id: 'blank-world',
		label: 'Blank world',
		description: 'A flat floor and nothing else.',
		kind: 'world',
		defaultName: 'Untitled world',
		build: () => [
			createSlot({
				id: 'floor',
				name: 'Floor',
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#4b5563' }, { type: 'collider', shape: 'box' }]
			})
		]
	},
	{
		id: 'blank-object',
		label: 'New object',
		description: 'A single grabbable cube to build a reusable object from.',
		kind: 'object',
		defaultName: 'Untitled object',
		build: () => [
			createSlot({
				name: 'Untitled object',
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#8b7cf6' },
					{ type: 'collider', shape: 'box' },
					{ type: 'grabbable', scalable: true }
				]
			})
		]
	}
];

export function getTemplate(id: string | null): StudioTemplate | undefined {
	return TEMPLATES.find((template) => template.id === id);
}
