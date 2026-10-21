import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { opensWorldMenu } from '../packages/engine/src/ecs/types.ts';
import { buildAtm, LOBBY_ATM } from '../src/lib/content/templates/atm.ts';
import { isBuiltinMeshId } from '../packages/engine/src/assets/ref.ts';
import { BUILTIN_ENTRIES } from '../src/lib/content/starterKit/catalog.ts';

const rotate = (q, v) => {
	const [x, y, z, w] = q;
	const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
	return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};

test('the machine is one object: unique ids, every part hangs from the root, built-in meshes only', () => {
	const tree = buildAtm();
	assert.equal(new Set(tree.map((slot) => slot.id)).size, tree.length);
	const roots = tree.filter((slot) => slot.parentId === null);
	assert.equal(roots.length, 1);
	assert.ok(tree.filter((slot) => slot !== roots[0]).every((slot) => slot.parentId === roots[0].id));
	for (const slot of tree) for (const component of slot.components) if (component.type === 'meshRenderer') assert.ok(isBuiltinMeshId(component.meshRef.id));
});

test('pressing the body, screen, keypad or tray opens the credits window; the machine carries no data a world could change', () => {
	const tree = buildAtm();
	for (const name of ['Body', 'Hood', 'Screen Bezel', 'Screen', 'Keypad', 'Cash Tray', 'Key 5']) {
		const slot = tree.find((candidate) => candidate.name === name);
		assert.ok(slot && opensWorldMenu(slot), `${name} opens it`);
	}
	assert.equal(tree.filter((slot) => slot.components.some((c) => c.type === 'atm')).every((slot) => slot.components.filter((c) => c.type === 'atm').every((c) => Object.keys(c).length === 1)), true);
	assert.equal(tree.some((slot) => slot.components.some((c) => c.type === 'codeBlock')), false, 'no script is involved');
	assert.equal(tree.find((slot) => slot.name === 'Glow').components.some((c) => c.type === 'atm'), false);
});

test('the ids can be chosen, so two machines can stand in the same world', () => {
	const ids = [...buildAtm({ id: 'a' }), ...buildAtm({ id: 'b' })].map((slot) => slot.id);
	assert.equal(new Set(ids).size, ids.length);
});

test('only the Starter Kit copy can be picked up', () => {
	assert.equal(buildAtm()[0].components.some((c) => c.type === 'grabbable'), false);
	assert.equal(buildAtm({ grabbable: true })[0].components.some((c) => c.type === 'grabbable'), true);
});

test('in the lobby its screen faces the spawn pad, and it stands clear of everything else', async () => {
	const front = rotate(LOBBY_ATM.rotation, [0, 0, -1]);
	const toSpawn = [0 - LOBBY_ATM.position[0], 0, 0.5 - LOBBY_ATM.position[2]];
	const length = Math.hypot(...toSpawn);
	const dot = (front[0] * toSpawn[0] + front[2] * toSpawn[2]) / length;
	assert.ok(dot > 0.99, `facing the spawn pad (${dot.toFixed(3)})`);
	const lobby = JSON.parse(await readFile(new URL('../src/lib/content/templates/lobby.json', import.meta.url), 'utf8'));
	for (const slot of lobby.filter((candidate) => !candidate.parentId && candidate.position[1] > 0.1 && !/floor|skybox|pad/.test(candidate.id))) {
		assert.ok(Math.hypot(slot.position[0] - LOBBY_ATM.position[0], slot.position[2] - LOBBY_ATM.position[2]) > 1.5, `${slot.id} is not on top of the machine`);
	}
	assert.ok(Math.abs(LOBBY_ATM.position[0]) < 11 && Math.abs(LOBBY_ATM.position[2]) < 11, 'on the floor');
});

test('the Starter Kit lists the ATM, and the lobby world has one', async () => {
	const entry = BUILTIN_ENTRIES.find((candidate) => candidate.id === 'atm');
	assert.ok(entry);
	assert.equal(entry.build().some((slot) => slot.components.some((c) => c.type === 'atm')), true);
	assert.notEqual(entry.build(), entry.build(), 'a fresh tree every time');
	const worlds = await readFile(new URL('../src/lib/content/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.match(worlds, /buildLobbyExtras\(\)/);
	const setup = await readFile(new URL('../src/lib/engineSetup.ts', import.meta.url), 'utf8');
	assert.match(setup, /buildLobbyExtras\(\)/);
	const { buildLobbyExtras } = await import('../src/lib/content/templates/lobbyExtras.ts');
	assert.ok(buildLobbyExtras().some((slot) => slot.id === 'lobby-atm' && slot.components.some((c) => c.type === 'container')));
});
