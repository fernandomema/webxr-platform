import type { Slot, SlotTree } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { buildArena } from './arena.ts';
import { buildBanners, buildBots, buildBubbles, buildBullets, buildFlashes, buildGuns, buildShields, buildTags, buildVeils } from './actors.ts';
import { buildCards, buildHuds, buildNumbers } from './hud.ts';
import { buildLobby } from './lobby.ts';
import { ID } from './kit.ts';
import { directorScript } from './script.ts';

/** The director and the slot where the commands that guests' radial menus leave are put. */
function buildHub(): Slot[] {
	return [
		createSlot({ id: ID.director, name: 'Director', components: [{ type: 'container' }, { type: 'scriptState', data: {} }, { type: 'codeBlock', code: directorScript() }] }),
		createSlot({ id: ID.commands, name: 'Commands', components: [{ type: 'container' }] })
	];
}

/**
 * ROUNDS VR: the duel of ROUNDS in 3D. Two fighters on a glass arena shoot each other, block, and after every round the loser shoots
 * a card to get stronger. Someone plays the blue side, the rival bot (or a second player) the orange one. The match is the director's
 * script; the engine provides the guns in the hand, the poses of the players, teleporting and the sync of the slots it moves.
 */
export function buildRounds(): SlotTree {
	return [...buildArena(), ...buildHuds(), ...buildNumbers(), ...buildHub(), ...buildLobby(), ...buildGuns(), ...buildShields(), ...buildTags(), ...buildVeils(), ...buildFlashes(), ...buildBanners(), ...buildBubbles(), ...buildBots(), ...buildBullets(), ...buildCards()];
}
