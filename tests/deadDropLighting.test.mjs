import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BUNDLED_LIGHTING } from '../src/lib/assets/bundledLighting.ts';
import { extractScene, sceneSignature } from '../src/lib/lighting/sceneExtract.ts';
import { specFor } from '../src/lib/lighting/bake.ts';
import { readHeader } from '../src/lib/lighting/format.ts';
import { buildDeadDrop } from '../src/lib/xr/templates/deadDrop.ts';
import { LIGHT_REGIONS, LIGHTING_WORLD, lightVolumeId } from '../src/lib/xr/templates/deadDropLighting.ts';

const tree = buildDeadDrop();
const find = (slot, type) => slot.components.find((c) => c.type === type);
const file = (url) => readFileSync(new URL(`../static${url}`, import.meta.url));

test('every region of Dead Drop has a baked file, and the world uses it', () => {
	for (const region of LIGHT_REGIONS) {
		const baked = BUNDLED_LIGHTING[`${LIGHTING_WORLD}/${region.id}`];
		assert.ok(baked, `${region.id} is baked (run npm run bake -- dead-drop)`);
		const slot = tree.find((s) => s.id === lightVolumeId(region.id));
		assert.equal(find(slot, 'lightVolume').data.assetId, baked.assetId);
	}
});

test('a baked file is the asset the world names, byte for byte', () => {
	for (const baked of Object.values(BUNDLED_LIGHTING)) {
		const hash = createHash('sha256').update(file(baked.url)).digest('hex');
		assert.equal(baked.assetId, `sha256:${hash}`, `${baked.url} matches its hash`);
	}
});

test('the baked lighting is fresh: changing the walls or lamps without baking again fails here', () => {
	for (const region of LIGHT_REGIONS) {
		const baked = BUNDLED_LIGHTING[`${LIGHTING_WORLD}/${region.id}`];
		const header = readHeader(new Uint8Array(file(baked.url)));
		const scene = extractScene(tree, { region: { min: region.min, max: region.max }, skyIntensity: 0, albedoScale: 0.4 });
		const spec = specFor(region.min, region.max, region.voxel);
		const signature = sceneSignature(scene, { min: spec.min, voxel: spec.voxel, dims: spec.dims }, { min: region.min, max: region.max });
		assert.equal(header.signature, signature, `${region.id} is out of date: run npm run bake -- dead-drop`);
	}
});
