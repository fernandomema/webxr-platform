import type { SlotTree } from '@kithin/engine/ecs/types';
import { bake, specFor } from '@kithin/engine/lighting/bake';
import { MAX_VOXELS, encodeAsync } from '@kithin/engine/lighting/format';
import { extractScene, sceneSignature } from '@kithin/engine/lighting/sceneExtract';
import type { V3 } from '@kithin/engine/lighting/types';

export type BakeQuality = 'draft' | 'normal' | 'high';

export interface BakeRequest {
	tree: SlotTree;
	quality: BakeQuality;
	/** The light the sky sends in, 0 to 2. */
	skyIntensity: number;
}

export type BakeReply =
	| { type: 'progress'; fraction: number }
	| { type: 'done'; bytes: Uint8Array; stats: BakeStats }
	| { type: 'error'; message: string };

export interface BakeStats {
	dims: [number, number, number];
	voxel: number;
	lights: number;
	seconds: number;
}

const PRESETS: Record<BakeQuality, { samples: number; passes: number; voxel: number }> = {
	draft: { samples: 24, passes: 1, voxel: 1 },
	normal: { samples: 48, passes: 2, voxel: 0.5 },
	high: { samples: 96, passes: 3, voxel: 0.25 }
};

/** Anything bigger than this on a side is a ground or a backdrop, not part of the place being lit. */
const MAX_EXTENT = 120;
const MARGIN = 1;
/** Voxels to aim for at most, so that a bake finishes in a reasonable time and the file stays small. */
const VOXEL_BUDGET = 1_500_000;

export class BakeError extends Error {}

/** The box the bake covers: every solid in the world except the huge ones, with a little room around. */
export function bakeRegion(tree: SlotTree): { min: V3; max: V3 } {
	const scene = extractScene(tree, { margin: 0 });
	const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
	for (const p of scene.primitives) {
		if (p.shape === 'ground' || p.max.some((v, k) => v - p.min[k] > MAX_EXTENT)) continue;
		for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.min[k]); max[k] = Math.max(max[k], p.max[k]); }
	}
	for (const l of scene.lights) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], l.position[k]); max[k] = Math.max(max[k], l.position[k]); }
	if (!min.every(Number.isFinite)) throw new BakeError('There is nothing to bake yet: add some objects to the world.');
	return { min: min.map((v) => v - MARGIN) as V3, max: max.map((v) => v + MARGIN) as V3 };
}

/** Runs a whole bake: extract the scene, bake it and encode the file. Pure and free of the DOM, so it runs in a worker. */
export async function runBake(request: BakeRequest, progress: (fraction: number) => void): Promise<{ bytes: Uint8Array; stats: BakeStats }> {
	const started = Date.now();
	const preset = PRESETS[request.quality];
	const region = bakeRegion(request.tree);
	// Coarsen the grid until it fits the budget: a large world gets a rougher bake rather than none.
	let voxel = preset.voxel;
	const cells = (v: number) => [0, 1, 2].reduce((n, k) => n * Math.max(1, Math.ceil((region.max[k] - region.min[k]) / v)), 1);
	while (cells(voxel) > Math.min(VOXEL_BUDGET, MAX_VOXELS)) voxel *= 1.25;
	const scene = extractScene(request.tree, { region, skyIntensity: request.skyIntensity });
	if (scene.lights.length === 0 && scene.sky.intensity <= 0) throw new BakeError('No lights are marked Baked. Tick Baked on the lights you want in the bake (or give the sky some light) and bake again.');
	const spec = specFor(region.min, region.max, voxel);
	const volume = bake(scene, spec, { samples: preset.samples, passes: preset.passes, progress });
	const signature = sceneSignature(scene, { min: spec.min, voxel: spec.voxel, dims: spec.dims }, region);
	const bytes = await encodeAsync(volume, signature);
	return { bytes, stats: { dims: spec.dims, voxel: spec.voxel, lights: scene.lights.length, seconds: (Date.now() - started) / 1000 } };
}
