import type { SlotTree } from '@kithin/engine/ecs/types';

/** What a pack's `world.ts` exports as default. The pack's id is the name of its folder. */
export interface PackWorld {
	name: string;
	description: string;
	/** A fresh scene on every call. */
	build: () => SlotTree;
}
