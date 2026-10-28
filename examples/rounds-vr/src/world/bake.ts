// Bakes the lighting of the lobby and of every map: node --experimental-transform-types src/world/bake.ts [region ...] [--force] [--threads=N]
// A region whose file is already for its scene (same surfaces, lights, sky and settings) is kept; the rest are baked on every core and checked,
// and a picture of each is left in .bake/ to look at.
// Each region is written to static/content/lighting-<region>.lvol (found by its hash, like any other file of the game, and by its name by
// `lighting.ts`, which the world builder reads to add a `lightVolume` to the lobby and to each map's group). Build the world again afterwards.
import { fileURLToPath } from 'node:url';
import { bakeRegions, type BakeRegion } from '@kithin/engine/lighting/job';
import type { Slot, SlotTree } from '@kithin/engine/ecs/types';
import { ARENA, MAPS } from './data.ts';
import { loadMapFragments, writeMapFragments } from './fragments.ts';
import { buildRounds } from './index.ts';
import { prepareScripts } from './script.ts';
import { ID } from './kit.ts';
import { modelAsset, modelBounds } from './models.ts';
import { readdirSync } from 'node:fs';
import { LOBBY_SKY, styleOf } from './style.ts';

interface Region {
	id: string;
	min: [number, number, number];
	max: [number, number, number];
	voxel: number;
	/** What the scene is like while it is baked: which map is on, and the sky. */
	map: number | null;
	sky: { top: string; horizon: string; bottom: string };
	skyIntensity: number;
}

const REGIONS: Region[] = [
	{ id: 'lobby', min: [-7.7, -0.1, 32.1], max: [7.7, 5.7, 42.9], voxel: 0.25, map: null, sky: LOBBY_SKY, skyIntensity: 0 },
	...MAPS.map((_, m): Region => ({
		id: `map-${m}`,
		min: [-ARENA.halfX - 0.6, ARENA.minY - 1, -ARENA.depth / 2 - 0.7],
		max: [ARENA.halfX + 0.6, ARENA.maxY + 0.4, ARENA.depth / 2 + 0.7],
		voxel: 0.55,
		map: m,
		sky: styleOf(m).sky,
		skyIntensity: 0.7
	}))
];

/** The world as it is while a region is baked: only that map on (none for the lobby), and the sky of that place. */
function sceneFor(region: Region, source: SlotTree): SlotTree {
	// Each map's fragment is built where its slot is on: only the map of the region is (none for the lobby); the extractor builds them in.
	return source.map((slot: Slot) => {
		const mapRoot = MAPS.findIndex((_, m) => slot.id === ID.map(m));
		if (mapRoot >= 0) return { ...slot, disabled: mapRoot !== region.map };
		const skybox = slot.components.find((c) => c.type === 'skybox');
		if (skybox) return { ...slot, components: slot.components.map((c) => (c.type === 'skybox' ? { ...c, topColor: region.sky.top, horizonColor: region.sky.horizon, bottomColor: region.sky.bottom } : c)) };
		return slot;
	});
}

/** The box each model fills, as the engine shows it (largest side 1, centred), by the asset id of its file. */
const MODEL_BOXES = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();
for (const file of readdirSync(new URL('../../static/content/models/', import.meta.url))) {
	if (!file.endsWith('.glb')) continue;
	const name = file.slice(0, -4);
	const { min, max } = modelBounds(name);
	const largest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	const centre = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
	MODEL_BOXES.set(modelAsset(name), { min: [0, 1, 2].map((k) => (min[k] - centre[k]) / largest) as [number, number, number], max: [0, 1, 2].map((k) => (max[k] - centre[k]) / largest) as [number, number, number] });
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const threads = Number(args.find((a) => a.startsWith('--threads='))?.slice(10)) || undefined;
const only = args.filter((a) => !a.startsWith('--'));
writeMapFragments();
await prepareScripts();
const tree = buildRounds();
const fragments = loadMapFragments();

const regions = REGIONS.filter((r) => only.length === 0 || only.includes(r.id)).map((region): BakeRegion => ({
	id: region.id,
	scene: sceneFor(region, tree),
	min: region.min,
	max: region.max,
	voxel: region.voxel,
	extract: { skyIntensity: region.skyIntensity, albedoScale: 1, modelBox: (id) => MODEL_BOXES.get(id) ?? null, fragments },
	bake: { samples: 160, passes: 2, blur: 2 }
}));
await bakeRegions(regions, { outDir: fileURLToPath(new URL('../../static/content/', import.meta.url)), previewDir: fileURLToPath(new URL('../../.bake/', import.meta.url)), force, threads, log: console.log });
