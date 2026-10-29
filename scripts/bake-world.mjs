// Bakes the lighting of a world. A built-in world goes into `static/worlds/<world>/lighting-<region>.lvol`, listed in
// `src/lib/content/bundledLighting.ts`. A world pack (worlds/<id>/, whose world.ts exports `lighting`) goes into
// `worlds/<id>/assets/lighting/<region>.lvol`, where it is an asset like any other.
// Run with: npm run bake -- <world> [region ...]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (path) => pathToFileURL(join(root, 'src/lib', path)).href;
const engine = (path) => pathToFileURL(join(root, 'packages/engine/src', path)).href;

// Each world: how to build its scene, and which volumes it is baked into.
const WORLDS = {
	'dead-drop': async () => {
		const { buildDeadDrop } = await import(src('content/templates/deadDrop.ts'));
		const { LIGHT_REGIONS, LIGHTING_WORLD } = await import(src('content/templates/deadDropLighting.ts'));
		return { name: LIGHTING_WORLD, tree: buildDeadDrop(), regions: LIGHT_REGIONS, skyIntensity: 0, albedoScale: 0.4 };
	},
	'bistro-rush': async () => {
		const { buildBistro } = await import(src('content/templates/bistro.ts'));
		const { BAKE, LIGHT_REGIONS, LIGHTING_WORLD } = await import(src('content/templates/bistroLighting.ts'));
		return { name: LIGHTING_WORLD, tree: buildBistro(), regions: LIGHT_REGIONS, ...BAKE };
	}
};

const { listPackIds, syncPackAssets } = await import(src('worldPacks/core.ts'));
const { bakedLightingPath } = await import(src('worldPacks/lighting.ts'));
const packs = listPackIds(join(root, 'worlds'));

const [worldId, ...only] = process.argv.slice(2);
if (!worldId || !(WORLDS[worldId] || packs.includes(worldId))) {
	console.error(`Usage: npm run bake -- <world> [region ...]\nWorlds: ${Object.keys(WORLDS).join(', ')}\nPacks: ${packs.join(', ') || '(none)'}`);
	process.exit(1);
}

// A pack says what to bake in its world.ts: `export const lighting = { regions, skyIntensity?, albedoScale? }`.
async function packWorld(id) {
	const module = await import(pathToFileURL(join(root, 'worlds', id, 'world.ts')).href);
	if (!module.lighting?.regions?.length) {
		console.error(`worlds/${id}/world.ts does not export \`lighting\` with regions to bake. See worlds/README.md.`);
		process.exit(1);
	}
	const { regions, skyIntensity = 0, albedoScale = 1 } = module.lighting;
	return { name: id, tree: module.default.build(), regions, skyIntensity, albedoScale, pack: true };
}

const { extractScene, sceneSignature } = await import(engine('lighting/sceneExtract.ts'));
const { bake, specFor } = await import(engine('lighting/bake.ts'));
const { encode } = await import(engine('lighting/format.ts'));
const { nodeCodec } = await import(engine('lighting/nodeCodec.ts'));

const world = WORLDS[worldId] ? await WORLDS[worldId]() : await packWorld(worldId);
const regions = only.length ? world.regions.filter((r) => only.includes(r.id)) : world.regions;
const dir = world.pack ? join(root, 'worlds', world.name, 'assets', 'lighting') : join(root, 'static/worlds', world.name);
mkdirSync(dir, { recursive: true });

// Keep what earlier runs listed for other worlds and regions.
const registryPath = join(root, 'src/lib/content/bundledLighting.ts');
const { BUNDLED_LIGHTING } = await import(`${src('content/bundledLighting.ts')}?t=${Date.now()}`);
const registry = { ...BUNDLED_LIGHTING };

for (const region of regions) {
	const started = Date.now();
	const scene = extractScene(world.tree, { region: { min: region.min, max: region.max }, skyIntensity: world.skyIntensity, albedoScale: world.albedoScale });
	const spec = specFor(region.min, region.max, region.voxel);
	const volume = bake(scene, spec);
	const signature = sceneSignature(scene, { min: spec.min, voxel: spec.voxel, dims: spec.dims }, { min: region.min, max: region.max });
	const bytes = encode(volume, signature, nodeCodec);
	const file = world.pack ? bakedLightingPath(region.id).split('/').pop() : `lighting-${region.id}.lvol`;
	writeFileSync(join(dir, file), bytes);
	const assetId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
	if (!world.pack) registry[`${world.name}/${region.id}`] = { assetId, url: `/worlds/${world.name}/${file}` };
	console.log(`${region.id}: ${spec.dims.join('x')} voxels, ${scene.lights.length} lights, ${(bytes.length / 1024).toFixed(0)} KiB, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (world.pack) {
	// The new files are assets of the pack: its assets.ts (and the dev server) pick them up.
	syncPackAssets(join(root, 'worlds', world.name));
	console.log(`Updated worlds/${world.name}/assets.ts. Use lightVolumeSlots(ASSETS, lighting.regions) in the world to place them.`);
	process.exit(0);
}

const lines = Object.keys(registry).sort().map((key) => `\t'${key}': { assetId: '${registry[key].assetId}', url: '${registry[key].url}' }`);
writeFileSync(registryPath, `/** Baked lighting shipped with built-in worlds. Written by \`npm run bake\`; do not edit by hand. */\nexport const BUNDLED_LIGHTING: Record<string, { assetId: \`sha256:\${string}\`; url: string }> = {\n${lines.join(',\n')}\n};\n`);
