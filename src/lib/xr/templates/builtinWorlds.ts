import type { SlotTree } from '$lib/ecs/types';
import lobby from './lobby.json';
import workshop from './workshop.json';
import popUpStore from './popUpStore.json';
import pulse from './pulse.json';
import avatarShowcase from './avatarShowcase.json';

/** The worlds that ship with the app: always there to go to, and the starting points for the Studio's world templates. */
export interface BuiltinWorld {
	id: 'lobby' | 'workshop' | 'pop-up-store' | 'pulse' | 'avatarShowcase';
	name: string;
	description: string;
	scene: SlotTree;
}

export const BUILTIN_WORLDS: readonly BuiltinWorld[] = [
	{ id: 'lobby', name: 'Lobby', description: 'A glowing spawn pad, a welcome sign, a mirror, a paint brush and a record player.', scene: lobby as SlotTree },
	{
		id: 'workshop',
		name: 'Workshop',
		description: 'A large hall to build in: work bays along the walls, an open build floor and a showcase stage.',
		scene: workshop as SlotTree
	},
	{
		id: 'pop-up-store',
		name: 'Pop Up Store',
		description: 'An open store to showcase objects and tools, with shelves, display islands and a featured gallery. Everything is free.',
		scene: popUpStore as SlotTree
	},
	{ id: 'avatarShowcase', name: 'avatarShowcase', description: 'Explore a compact indoor world with its original room geometry and materials.', scene: avatarShowcase as SlotTree },
	{
		id: 'pulse',
		name: 'Feedback Center',
		description: 'An indoor feedback center: vote ideas and bugs up or down, send suggestions and share how you feel.',
		scene: pulse as SlotTree
	}
];

export const getBuiltinWorld = (id: string): BuiltinWorld | undefined => BUILTIN_WORLDS.find((world) => world.id === id);
