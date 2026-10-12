import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';
import { buildDeadDrop } from '../src/lib/xr/templates/deadDrop.ts';
import { ID, nonSolidIds } from '../src/lib/xr/templates/deadDropKit.ts';
import { GRID, POOLS } from '../src/lib/xr/templates/deadDropData.ts';
import { HUB_ROOM } from '../src/lib/xr/templates/deadDropHub.ts';

const tree = buildDeadDrop();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('Dead Drop is a valid scene: unique ids, known parents, built-in meshes, and a size a headset can take', () => {
	assert.equal(byId.size, tree.length, 'ids are unique');
	// The text, buttons and rows of the three screens are slots too, but they draw nothing but a flat panel.
	assert.ok(tree.length > 300 && tree.length < 1500, `${tree.length} slots`);
	for (const slot of tree) {
		assert.ok(slot.position.every(Number.isFinite) && slot.scale.every((v) => Number.isFinite(v) && v > 0), `${slot.id} has real numbers`);
		assert.equal(slot.rotation.length, 4);
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id), `${slot.id} uses a built-in mesh`);
	}
	assert.equal(tree.filter((slot) => find(slot, 'skybox')).length, 1, 'one sky');
	assert.equal(tree.filter((slot) => find(slot, 'spawnPoint')).length, 1);
	const lights = tree.filter((slot) => find(slot, 'pointLight') && !find(slot, 'pointLight').baked);
	assert.ok(lights.length <= 10, 'at most ten lights');
	assert.ok(lights.filter((slot) => slot.position[0] > 100).length <= 6, 'and few in sight of one another: a material only takes a handful');
});

test('every script compiles, and the slots they name exist', () => {
	const scripts = tree.filter((slot) => find(slot, 'codeBlock'));
	assert.equal(scripts.length, 1 + POOLS.guns, 'the director and one script per gun');
	for (const slot of scripts) {
		const code = find(slot, 'codeBlock').code;
		assert.doesNotThrow(() => new Function('ctx', code), `${slot.id}'s script is valid`);
	}
	const director = find(byId.get(ID.director), 'codeBlock').code;
	for (const match of director.matchAll(/["'](dd-[a-z0-9-]+)["']/g)) {
		const id = match[1];
		assert.ok(byId.has(id) || id.endsWith('-'), `the director names ${id}`);
	}
	for (const id of nonSolidIds()) assert.ok(byId.has(id), `${id} is a pooled slot of the world`);
});

test('the buttons exist, and so do the pools the script moves around', () => {
	for (const id of [ID.join, ID.leave, ID.start]) assert.equal(find(byId.get(id), 'uiElement').kind, 'button');
	assert.equal(find(byId.get(ID.message), 'uiElement').kind, 'text');
	assert.ok(find(byId.get(ID.flush), 'scriptState') && byId.get(ID.commands));
	for (let i = 0; i < POOLS.soldiers; i++) assert.ok(byId.has(ID.soldier(i)));
	for (let i = 0; i < POOLS.turrets; i++) assert.ok(byId.has(ID.turret(i)));
	for (let i = 0; i < POOLS.loot; i++) assert.ok(byId.has(ID.loot(i)) && find(byId.get(`${ID.loot(i)}-label`), 'textDisplay'));
	for (let i = 0; i < POOLS.bags; i++) assert.ok(byId.has(ID.bag(i)));
	for (let i = 0; i < POOLS.tracers; i++) assert.ok(byId.has(ID.tracer(i)));
});

test('the pooled actors wait out of sight, and the structure the layout chooses between starts switched off', () => {
	for (const id of nonSolidIds().filter((id) => !id.startsWith('dd-gun'))) assert.ok(byId.get(id).position[1] <= -100, `${id} is parked`);
	const props = tree.filter((slot) => slot.id.startsWith('dd-p-'));
	assert.equal(props.length, 9 * 2 * 4);
	assert.ok(props.every((slot) => slot.disabled === true));
	const doorways = tree.filter((slot) => /^dd-e-[en]\d\d-(l|r|top)$/.test(slot.id));
	assert.equal(doorways.length, 12 * 3);
	assert.ok(doorways.every((slot) => slot.disabled === true));
	assert.equal(tree.filter((slot) => /^dd-e-[en]\d\d$/.test(slot.id)).length, 12, 'twelve walls between rooms, closed to begin with');
	assert.ok(tree.filter((slot) => /^dd-e-[en]\d\d$/.test(slot.id)).every((slot) => !slot.disabled));
});

test('the raid lies far from the bunker, whose guns hang from a rack the squad can reach', () => {
	assert.ok(GRID.origin[0] - (GRID.size * GRID.cell) / 2 > HUB_ROOM.maxX + 50, 'no view from one to the other');
	for (let i = 0; i < POOLS.guns; i++) {
		const gun = byId.get(ID.gun(i));
		assert.ok(find(gun, 'grabbable') && find(gun, 'equippable'));
		assert.ok(gun.position[0] > HUB_ROOM.minX && gun.position[0] < HUB_ROOM.maxX && gun.position[2] > HUB_ROOM.minZ && gun.position[2] < HUB_ROOM.maxZ);
		assert.equal(byId.get(`${ID.gun(i)}-muzzle`).parentId, ID.gun(i));
		assert.ok(tree.some((slot) => slot.parentId === ID.gun(i) && find(slot, 'collider')), 'a hand can find it');
	}
});

test('Dead Drop is registered as a development world, with a description', async () => {
	const source = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.match(source, /id: 'dead-drop'/);
	assert.match(/DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1], /'dead-drop'/);
	assert.match(source, /scene: buildDeadDrop\(\)/);
});
