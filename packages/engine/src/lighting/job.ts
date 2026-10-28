import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SlotTree } from '../ecs/types.ts';
import { bakeSettingsKey, specFor, type BakeOptions } from './bake.ts';
import { encode, readHeader } from './format.ts';
import { nodeCodec } from './nodeCodec.ts';
import { encodePng } from './nodePng.ts';
import { bakeParallel } from './parallel.ts';
import { insideSolid, isSolidShape } from './primitives.ts';
import { analyzeVolume, sliceImage, type VolumeQuality } from './qa.ts';
import { extractScene, sceneSignature, type ExtractOptions } from './sceneExtract.ts';
import type { V3 } from './types.ts';

/** One place of a world whose light is baked into a file of its own. */
export interface BakeRegion {
	id: string;
	/** The world as it is while this region is baked (a map on, the sky of the place...). */
	scene: SlotTree;
	min: V3;
	max: V3;
	voxel: number;
	/** What reaches the world from the sky, and the other numbers `extractScene` takes. */
	extract?: Omit<ExtractOptions, 'region'>;
	bake?: BakeOptions;
}

export interface BakeJobOptions {
	/** Where `lighting-<id>.lvol` is written. */
	outDir: string;
	/** Where the preview pictures go (`<id>.png`); none when not given. */
	previewDir?: string;
	/** Bake even when the file on disk is already for this scene. */
	force?: boolean;
	threads?: number;
	log?: (line: string) => void;
}

export interface BakeJobResult {
	id: string;
	assetId: `sha256:${string}`;
	/** True when the file on disk was already for this scene and was kept. */
	skipped: boolean;
	signature: string;
	seconds: number;
	bytes: number;
	/** Missing when skipped. */
	quality?: VolumeQuality;
}

const sha = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/**
 * Bakes one region and writes its file, unless the file already there was baked from the same scene with the same settings (the
 * signature in its header says so): a change to one map then bakes that map and nothing else. The bake uses all the cores, checks
 * the result (`analyzeVolume`) and leaves a picture of two slices of it to look at.
 */
export async function bakeRegion(region: BakeRegion, options: BakeJobOptions): Promise<BakeJobResult> {
	const started = Date.now();
	const log = options.log ?? (() => {});
	mkdirSync(options.outDir, { recursive: true });
	const file = join(options.outDir, `lighting-${region.id}.lvol`);
	const scene = extractScene(region.scene, { ...region.extract, region: { min: region.min, max: region.max } });
	for (const light of scene.lights) for (const p of scene.primitives) if (p.opaque && isSolidShape(p.shape) && insideSolid(p, light.position)) log(`  warning: a light at ${light.position.map((v) => v.toFixed(2))} is inside ${p.id}`);
	const spec = specFor(region.min, region.max, region.voxel);
	const signature = sceneSignature(scene, { min: spec.min, voxel: spec.voxel, dims: spec.dims }, { min: region.min, max: region.max }, 24, bakeSettingsKey(region.bake));

	if (!options.force && existsSync(file)) {
		const existing = new Uint8Array(readFileSync(file));
		try {
			if (readHeader(existing).signature === signature) {
				log(`${region.id}: unchanged, kept`);
				return { id: region.id, assetId: sha(existing), skipped: true, signature, seconds: (Date.now() - started) / 1000, bytes: existing.length };
			}
		} catch { /* a damaged file is baked again */ }
	}

	const { volume, plan } = await bakeParallel(scene, spec, { ...region.bake, threads: options.threads });
	const bytes = encode(volume, signature, nodeCodec);
	writeFileSync(file, bytes);
	const quality = analyzeVolume(volume, plan);
	if (options.previewDir) {
		mkdirSync(options.previewDir, { recursive: true });
		const image = sliceImage(volume, plan);
		writeFileSync(join(options.previewDir, `${region.id}.png`), encodePng(image.rgba, image.width, image.height));
	}
	const seconds = (Date.now() - started) / 1000;
	log(`${region.id}: ${spec.dims.join('x')} voxels, ${scene.lights.length} lights, ${(bytes.length / 1024).toFixed(0)} KiB, ${seconds.toFixed(1)} s, noise ${(quality.noise * 100).toFixed(1)}%, dark ${(quality.dark * 100).toFixed(0)}%, ${quality.straddling} cut by thin walls`);
	for (const warning of quality.warnings) log(`  warning: ${warning}`);
	return { id: region.id, assetId: sha(bytes), skipped: false, signature, seconds, bytes: bytes.length, quality };
}

/** Bakes regions one after the other (each one uses every core). */
export async function bakeRegions(regions: readonly BakeRegion[], options: BakeJobOptions): Promise<BakeJobResult[]> {
	const results: BakeJobResult[] = [];
	for (const region of regions) results.push(await bakeRegion(region, options));
	return results;
}
