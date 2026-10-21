import type { SlotTree } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { ID } from './bistroData.ts';
import { buildHall } from './bistroHall.ts';
import { buildLighting } from './bistroLighting.ts';
import { buildLobby } from './bistroLobby.ts';
import { buildProps } from './bistroProps.ts';
import { directorScript } from './bistroScript.ts';

/**
 * Bistro Rush: a cooperative restaurant game in the spirit of Overcooked and PlateUp. A back room (the lobby) where a chef sees
 * what they have earned and chooses a restaurant made from a seed; a hall where the cooks carry, chop, cook, plate and serve
 * while the guests' patience runs down; and between the days, blueprints to buy and a kitchen to move about. Alone or with
 * friends. The game is one script of the world (see bistroScript.ts); the engine only provides hands, positions and storage.
 */
export function buildBistro(): SlotTree {
	return [
		// The director holds the script; the screens with buttons hang below it, so that a press on any of them reaches it.
		createSlot({ id: ID.root, name: 'Bistro Director', components: [{ type: 'container' }, { type: 'codeBlock', code: directorScript() }] }),
		createSlot({ id: ID.flush, name: 'Flush', components: [{ type: 'scriptState', data: { n: 0 } }] }),
		...buildLobby(),
		...buildHall(),
		...buildLighting(),
		...buildProps()
	];
}
