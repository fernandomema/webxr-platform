import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';
import { ARCADE_FRAMES, buildArcade } from '../src/lib/xr/templates/arcade.ts';
import { ROOM } from '../src/lib/xr/templates/arcadeRoom.ts';
import { machineIds } from '../src/lib/xr/templates/arcadeKit.ts';
import { runMachine } from './helpers/arcadeMachine.mjs';

const tree = buildArcade();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);
const PREFIXES = { darts: 'dt', ringToss: 'rt', basketball: 'bb', whack: 'wm', striker: 'st', airHockey: 'ah' };

test('the arcade is a valid scene: unique ids, known parents, built-in meshes, and a size a headset can take', () => {
	assert.equal(byId.size, tree.length, 'ids are unique');
	assert.ok(tree.length > 200 && tree.length < 600, `${tree.length} slots`);
	for (const slot of tree) {
		assert.equal(slot.position.length, 3);
		assert.equal(slot.rotation.length, 4);
		assert.equal(slot.scale.length, 3);
		assert.ok(slot.position.every(Number.isFinite) && slot.scale.every((v) => Number.isFinite(v) && v > 0), `${slot.id} has real numbers`);
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id), `${slot.id} uses a built-in mesh`);
	}
	assert.equal(tree.filter((slot) => find(slot, 'skybox')).length, 1, 'one sky');
	assert.equal(tree.filter((slot) => find(slot, 'spawnPoint')).length, 1);
	assert.ok(tree.filter((slot) => find(slot, 'pointLight')).length <= 10, 'at most ten lights');
});

test('every machine has a script on its control panel, the six buttons the script listens to, and a board for the games and for the best scores', () => {
	for (const [name, prefix] of Object.entries(PREFIXES)) {
		const ids = machineIds(prefix);
		assert.ok(find(byId.get(ids.panel), 'codeBlock'), `${name} has a script`);
		assert.doesNotThrow(() => new Function('ctx', find(byId.get(ids.panel), 'codeBlock').code), `${name}'s script is valid`);
		for (const id of [ids.one, ids.versus, ids.join, ids.start, ids.leave]) assert.equal(find(byId.get(id), 'uiElement').kind, 'button', `${id} is a button`);
		assert.deepEqual(find(byId.get(ids.board), 'scoreboard').columns, ['Score']);
		assert.deepEqual(find(byId.get(ids.top), 'scoreboard').columns, ['Score']);
		assert.ok(find(byId.get(ids.root), 'scriptState'));
	}
});

test('every slot the scripts name exists, so none of them writes to nothing', () => {
	for (const [name, prefix] of Object.entries(PREFIXES)) {
		const code = find(byId.get(machineIds(prefix).panel), 'codeBlock').code;
		for (const match of code.matchAll(new RegExp(`'(${prefix}-[a-z0-9-]+)'`, 'g'))) {
			const id = match[1];
			assert.ok(byId.has(id) || id.endsWith('-'), `${name}: the script names ${id}`);
		}
	}
});

test('every grabbable has the scripted holder tracking, a hit shape for the hand, and is a root or inside its own machine', () => {
	const grabbables = tree.filter((slot) => find(slot, 'grabbable'));
	assert.ok(grabbables.length >= 6 + 6 + 3 + 4 + 2 + 1);
	for (const slot of grabbables) {
		assert.equal(find(slot, 'grabbable').autoGrip, true, `${slot.id} grips`);
		assert.ok(find(slot, 'scriptState') && find(slot, 'codeBlock'), `${slot.id} remembers its holder`);
		assert.ok(find(slot, 'collider') || tree.some((child) => child.parentId === slot.id && find(child, 'collider')), `${slot.id} can be picked up`);
	}
});

test('the machines stand inside the hall, clear of one another, and face its middle', () => {
	for (const [name, frame] of Object.entries(ARCADE_FRAMES)) {
		assert.ok(frame.o[0] > ROOM.minX && frame.o[0] < ROOM.maxX && frame.o[2] > ROOM.minZ && frame.o[2] < ROOM.maxZ, `${name} is in the hall`);
		if (name === 'airHockey') continue; // the table stands in the middle of the hall
		const middle = [0 - frame.o[0], 8 - frame.o[2]];
		// The players stand on the machine's -z side, so the machine's z axis points away from the middle of the hall.
		assert.ok(frame.d[0] * middle[0] + frame.d[2] * middle[1] <= 1e-9, `${name} looks towards the hall`);
	}
	const frames = Object.entries(ARCADE_FRAMES);
	for (const [a, fa] of frames) for (const [b, fb] of frames) if (a < b) assert.ok(Math.hypot(fa.o[0] - fb.o[0], fa.o[2] - fb.o[2]) >= 6, `${a} and ${b} are apart`);
	// Nothing sticks out through a wall.
	for (const slot of tree) {
		if (slot.parentId !== null || /^arcade-(wall|ceiling|floor|strip|skirt)/.test(slot.id)) continue;
		const [x, , z] = slot.position;
		assert.ok(x > ROOM.minX - 0.5 && x < ROOM.maxX + 0.5 && z > ROOM.minZ - 0.5 && z < ROOM.maxZ + 0.5, `${slot.id} is inside the hall`);
	}
});

test('all six machines run together in one world: pressing 1 PLAYER on each starts only that machine', async () => {
	const worlds = Object.entries(PREFIXES).map(([name, prefix]) => ({ name, prefix, world: runMachine({ tree, frame: ARCADE_FRAMES[name], panelId: machineIds(prefix).panel }) }));
	for (const { world, prefix } of worlds) {
		world.press(machineIds(prefix).one);
		await world.tick(0.2);
		assert.match(world.text(machineIds(prefix).message), /Me/, `${prefix} is playing`);
		assert.deepEqual(world.logs, [], `${prefix} did not complain`);
	}
});

test('the Arcade is registered as a development world, with a description', async () => {
	const source = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.match(source, /id: 'arcade'/);
	assert.match(/DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1], /'arcade'/);
	assert.match(source, /scene: buildArcade\(\)/);
});

test('the welcome sign faces the arrival point and the link to the lobby is a world link', () => {
	assert.deepEqual(byId.get('arcade-welcome').rotation, [0, 0, 0, 1], 'read from the south, where players arrive');
	assert.ok(byId.get('arcade-welcome').position[2] > byId.get('arcade-spawn').position[2]);
	assert.deepEqual(find(byId.get('arcade-lobby-link'), 'worldLink').target, { kind: 'builtin', id: 'lobby' });
});
