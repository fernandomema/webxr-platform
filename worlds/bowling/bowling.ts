import type { Slot, SlotTree } from '@kithin/engine/ecs/types';
import { lightVolumeSlots, type PackLighting } from '../../src/lib/worldPacks/lighting.ts';
import { ASSETS } from './assets.ts';
import { buildHall } from './bowlingHall.ts';
import { HALL } from './bowlingLayout.ts';
import { buildLanes } from './bowlingLanes.ts';
import { DIRECTOR_SCRIPT, JUKEBOX_SCRIPT } from './bowlingScript.ts';

/**
 * Neon Pin Lanes: a social bowling alley for a headset (a desktop works too). Four lanes in two pairs, a ball return between the lanes of a
 * pair, a desk behind every approach with its scoreboard and panel, a bar, booths, a shoe counter and a jukebox. Grab a ball, swing and let
 * go: it rolls down the lane, knocks the pins over and comes back. Up to four people share a lane and take turns through ten frames, with
 * strikes, spares and the real scoring; best games go to a Hall of Fame. Bumpers and aim help are there for newcomers.
 *
 * The world's rules and physics are in bowlingLogic.ts (plain JavaScript, tested without a browser), the script that runs the lanes in
 * bowlingScript.ts; everything else here is scenery and the controls.
 */
export const lighting: PackLighting = {
	regions: [{ id: 'alley', min: [HALL.minX, 0, HALL.minZ], max: [HALL.maxX, HALL.height, HALL.maxZ], voxel: 0.4 }],
	skyIntensity: 0,
	albedoScale: 0.85
};

/**
 * Every lamp is marked as baked: the baker takes those, and the engine draws a baked light live only while the baked volume is not in use.
 * A material takes only so many lights (a GPU allows about ten light blocks in one shader), so the scene keeps just LIVE_LIGHTS as real lamps; the
 * rest exist only while baking (`KITHIN_BAKE=1 npm run bake -- bowling`) and their light is in the volume.
 */
const LIVE_LIGHTS = new Set(['bw-light-approach-0', 'bw-light-approach-1', 'bw-light-lobby-0', 'bw-light-bar', 'bw-light-juke', 'bw-light-end', 'bw-l1-spot', 'bw-l2-spot']);
const baking = Boolean((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.KITHIN_BAKE);
const isLamp = (slot: Slot) => slot.components.some((c) => c.type === 'pointLight' || c.type === 'spotLight');

const bake = (slots: Slot[]): Slot[] =>
	slots
		.filter((slot) => baking || !isLamp(slot) || LIVE_LIGHTS.has(slot.id))
		.map((slot) => ({ ...slot, components: slot.components.map((c) => (c.type === 'pointLight' || c.type === 'spotLight' ? { ...c, baked: true } : c)) }));

export function buildBowling(): SlotTree {
	return [...bake([...buildHall(), ...buildLanes(DIRECTOR_SCRIPT, JUKEBOX_SCRIPT)]), ...lightVolumeSlots(ASSETS, lighting.regions)];
}
