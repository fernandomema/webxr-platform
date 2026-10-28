// Writes the files of the game's world: node --experimental-transform-types src/world/build.ts
// The maps (one fragment each), then the world that names them, with its scripts bundled from `src/script`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { validateWorldScene } from '@kithin/engine/worlds/package';
import { writeMapFragments } from './fragments.ts';
import { buildRounds } from './index.ts';
import { prepareScripts } from './script.ts';

const fragments = writeMapFragments();
await prepareScripts();
const scene = buildRounds();
validateWorldScene(scene);
const world = {
	formatVersion: 1,
	name: 'ROUNDS VR',
	description: 'A duel in 3D and VR: shoot, block, and after every round shoot a card to get stronger.',
	defaultVisibility: 'solo',
	scene
};
const out = new URL('../../static/content/worlds/rounds.json', import.meta.url);
mkdirSync(new URL('./', out), { recursive: true });
writeFileSync(out, JSON.stringify(world));
console.log(`rounds.json: ${scene.length} slots; ${fragments} map fragments written`);
