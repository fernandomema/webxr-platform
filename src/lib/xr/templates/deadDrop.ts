import type { SlotTree } from '../../ecs/types';
import { buildBags, buildDeathVeils, buildDogs, buildGuns, buildLoot, buildSoldiers, buildTracers, buildTurrets } from './deadDropActors.ts';
import { RACK, buildConsole, buildHub } from './deadDropHub.ts';
import { buildStashScreen, buildTraderScreen, buildTraderStand } from './deadDropScreens.ts';
import { buildRaid } from './deadDropRaid.ts';
import { buildLighting } from './deadDropLighting.ts';
import { buildGearWall } from './deadDropGear.ts';

/**
 * Dead Drop: a cooperative extraction shooter. The squad prepares in a bunker, is sent into a raid on a map made from a seed,
 * loots it while soldiers and turrets hunt by sight and by noise, and has to reach an exit alive: what a player carries is
 * theirs only if they get out. The game is a script of the world (see deadDropScript.ts); the engine only provides the weapons
 * in the hand, the poses of the players, the walls and the storage.
 */
export function buildDeadDrop(): SlotTree {
	return [
		...buildHub(),
		...buildLighting(),
		...buildGearWall(),
		...buildConsole(),
		...buildStashScreen(),
		...buildTraderScreen(),
		...buildTraderStand(),
		...buildGuns(RACK),
		...buildRaid(),
		...buildSoldiers(),
		...buildDogs(),
		...buildTurrets(),
		...buildLoot(),
		...buildBags(),
		...buildTracers(),
		...buildDeathVeils()
	];
}
