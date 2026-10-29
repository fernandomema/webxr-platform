import type { PackWorld } from '../../src/lib/worldPacks/types.ts';
import { buildBeatTurntable } from './beatTurntable.ts';

export default {
	name: 'Beat Turntable',
	description: 'A rhythm game played with records: put a disc on the turntable and cut the blocks that the song itself calls for. Scores are kept per song.',
	build: buildBeatTurntable
} satisfies PackWorld;
