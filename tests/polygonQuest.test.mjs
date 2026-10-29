import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseGlb } from '../packages/engine/src/assets/glb.ts';
import { ASSET_LIMITS } from '../packages/engine/src/assets/limits.ts';

const scenePath = new URL('../src/lib/content/templates/avatarShowcase.json', import.meta.url);
const modelPath = new URL('../static/worlds/polygon-quest/room.glb', import.meta.url);

test('Avatar Showcase scene refers to the bundled, valid GLB and has a walkable floor', async () => {
	const scene = JSON.parse(await readFile(scenePath, 'utf8'));
	const bytes = await readFile(modelPath);
	const model = scene.find((slot) => slot.id === 'polygon-quest-room');
	const floor = scene.find((slot) => slot.id === 'floor');
	const ref = model.components.find((component) => component.type === 'meshRenderer').meshRef;
	const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
	assert.equal(ref.assetId, hash);
	assert.ok(!model.components.some((component) => component.type === 'collider'), 'the room is not its own collider: invisible boxes round its walls are');
	assert.ok(floor.components.some((component) => component.type === 'collider'));
	const stats = parseGlb(bytes);
	assert.ok(stats.triangles > 1000 && stats.triangles < ASSET_LIMITS.maxTriangles);
	assert.ok(stats.images > 0 && stats.images <= ASSET_LIMITS.maxImages);
	const jsonLength = bytes.readUInt32LE(12);
	const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
	const textured = gltf.materials.filter((material) => material.pbrMetallicRoughness.baseColorTexture);
	assert.ok(textured.length >= 7);
	assert.ok(textured.filter((material) => material.normalTexture && material.occlusionTexture && material.pbrMetallicRoughness.metallicRoughnessTexture).length >= 6);
	assert.ok(gltf.materials.some((material) => material.emissiveTexture));
	assert.equal(scene[0].components[0].toneMapping, 'aces');
	for (const [direction, face] of Object.entries({ Px: 0, Nx: 1, Py: 2, Ny: 3, Pz: 4, Nz: 5 })) {
		const probeBytes = await readFile(new URL(`../static/worlds/polygon-quest/probe/face-${face}.png`, import.meta.url));
		assert.deepEqual(scene[0].components[0][`reflection${direction}`], { kind: 'asset', assetId: `sha256:${createHash('sha256').update(probeBytes).digest('hex')}` });
	}
	assert.equal(scene.filter((slot) => slot.components.some((component) => component.type === 'pointLight')).length, 3);
	assert.ok(bytes.length < ASSET_LIMITS.maxBytes);
	const extents = stats.bounds.max.map((value, index) => value - stats.bounds.min[index]);
	const roomBottom = model.position[1] - model.scale[1] * extents[1] / Math.max(...extents) / 2;
	assert.ok(Math.abs(roomBottom) < 0.1);
});

test('Avatar Showcase has a few invisible box colliders for its walls instead of a collider on the model', async () => {
	const scene = JSON.parse(await readFile(scenePath, 'utf8'));
	const walls = scene.filter((slot) => slot.id.startsWith('polygon-quest-wall-'));
	assert.ok(walls.length >= 8 && walls.length <= 20, 'a handful of boxes, not a copy of the model');
	for (const wall of walls) {
		const mesh = wall.components.find((component) => component.type === 'meshRenderer');
		assert.equal(mesh.opacity, 0, `${wall.name} is not drawn`);
		assert.ok(wall.components.some((component) => component.type === 'collider' && component.shape === 'box'));
	}
});
