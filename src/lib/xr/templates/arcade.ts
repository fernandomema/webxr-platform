import type { SlotTree } from '../../ecs/types';
import { makeFrame } from './arcadeKit.ts';
import { buildAirHockey } from './arcadeAirHockey.ts';
import { buildBasketball } from './arcadeBasketball.ts';
import { buildDarts } from './arcadeDarts.ts';
import { buildRingToss } from './arcadeRingToss.ts';
import { buildArcadeRoom } from './arcadeRoom.ts';
import { buildStriker } from './arcadeStriker.ts';
import { buildWhack } from './arcadeWhack.ts';

/**
 * Where each machine stands: its origin on the floor and the way it turns. A machine faces the middle of the hall; the
 * players stand in front of it. The back wall of the hall is at z = 17 and the side walls at x = -13 and x = 13.
 */
export const ARCADE_FRAMES = {
	darts: makeFrame(-8, 16.8, 0),
	ringToss: makeFrame(0, 15.1, 0),
	basketball: makeFrame(8, 14.6, 0),
	whack: makeFrame(-11.65, 9, -Math.PI / 2),
	striker: makeFrame(11.4, 9, Math.PI / 2),
	airHockey: makeFrame(0, 7, 0)
} as const;

/**
 * The Arcade: a hall with six games, each playable alone or against friends. The games are scripts of the world (see
 * arcadeSession.ts for what they share); the engine only provides the objects, the hands and the leaderboards.
 */
export function buildArcade(): SlotTree {
	return [
		...buildArcadeRoom(),
		...buildDarts(ARCADE_FRAMES.darts),
		...buildRingToss(ARCADE_FRAMES.ringToss),
		...buildBasketball(ARCADE_FRAMES.basketball),
		...buildWhack(ARCADE_FRAMES.whack),
		...buildStriker(ARCADE_FRAMES.striker),
		...buildAirHockey(ARCADE_FRAMES.airHockey)
	];
}
