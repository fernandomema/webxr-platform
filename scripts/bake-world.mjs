// Bakes the lighting of a built-in world into `static/worlds/<world>/lighting-<region>.lvol` and lists the files in
// `src/lib/assets/bundledLighting.ts`. Run with: npm run bake -- <world> [region ...]
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (path) => pathToFileURL(join(root, 'src/lib', path)).href;

// Each world: how to build its scene, and which volumes it is baked into.
const WORLDS = {
	'dead-drop': async () => {
		const { buildDeadDrop } = await import(src('xr/templates/deadDrop.ts'));
		const { LIGHT_REGIONS, LIGHTING_WORLD } = await import(src('xr/templates/deadDropLighting.ts'));
		return { name: LIGHTING_WORLD, tree: buildDeadDrop(), regions: LIGHT_REGIONS, skyIntensity: 0, albedoScale: 0.4 };
	},
	'bistro-rush': async () => {
		const { buildBistro } = await import(src('xr/templates/bistro.ts'));
		const { BAKE, LIGHT_REGIONS, LIGHTING_WORLD } = await import(src('xr/templates/bistroLighting.ts'));
		return { name: LIGHTING_WORLD, tree: buildBistro(), regions: LIGHT_REGIONS, ...BAKE };
	}
};

const [worldId, ...only] = process.argv.slice(2);
if (!worldId || !WORLDS[worldId]) {
	console.error(`Usage: npm run bake -- <world> [region ...]\nWorlds: ${Object.keys(WORLDS).join(', ')}`);
	process.exit(1);
}

const { extractScene, sceneSignature } = await import(src('lighting/sceneExtract.ts'));
const { bake, specFor } = await import(src('lighting/bake.ts'));
const { encode } = await import(src('lighting/format.ts'));
const { nodeCodec } = await import(src('lighting/nodeCodec.ts'));

const world = await WORLDS[worldId]();
const regions = only.length ? world.regions.filter((r) => only.includes(r.id)) : world.regions;
const dir = join(root, 'static/worlds', world.name);
mkdirSync(dir, { recursive: true });

// Keep what earlier runs listed for other worlds and regions.
const registryPath = join(root, 'src/lib/assets/bundledLighting.ts');
const { BUNDLED_LIGHTING } = await import(`${src('assets/bundledLighting.ts')}?t=${Date.now()}`);
const registry = { ...BUNDLED_LIGHTING };

for (const region of regions) {
	const started = Date.now();
	const scene = extractScene(world.tree, { region: { min: region.min, max: region.max }, skyIntensity: world.skyIntensity, albedoScale: world.albedoScale });
	const spec = specFor(region.min, region.max, region.voxel);
	const volume = bake(scene, spec);
	const signature = sceneSignature(scene, { min: spec.min, voxel: spec.voxel, dims: spec.dims }, { min: region.min, max: region.max });
	const bytes = encode(volume, signature, nodeCodec);
	const file = `lighting-${region.id}.lvol`;
	writeFileSync(join(dir, file), bytes);
	const assetId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
	registry[`${world.name}/${region.id}`] = { assetId, url: `/worlds/${world.name}/${file}` };
	console.log(`${region.id}: ${spec.dims.join('x')} voxels, ${scene.lights.length} lights, ${(bytes.length / 1024).toFixed(0)} KiB, ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const lines = Object.keys(registry).sort().map((key) => `\t'${key}': { assetId: '${registry[key].assetId}', url: '${registry[key].url}' }`);
writeFileSync(registryPath, `/** Baked lighting shipped with built-in worlds. Written by \`npm run bake\`; do not edit by hand. */\nexport const BUNDLED_LIGHTING: Record<string, { assetId: \`sha256:\${string}\`; url: string }> = {\n${lines.join(',\n')}\n};\n`);
