import type { PackWorld } from '../../src/lib/worldPacks/types.ts';
import { buildBowling } from './bowling.ts';

export { lighting } from './bowling.ts';

export default {
	name: 'Neon Pin Lanes',
	description: 'A social bowling alley: four lanes, real ten-frame scoring for up to four players a lane, bumpers and aim help, a bar, booths and a jukebox. Grab a ball and roll.',
	build: buildBowling
} satisfies PackWorld;
