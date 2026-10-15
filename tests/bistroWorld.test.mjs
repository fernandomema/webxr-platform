import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';
import { buildBistro } from '../src/lib/xr/templates/bistro.ts';
import { DIVIDERS, HALL, ID, KINDS, LOBBY, LOOKS, MODELS, PARTS, PORCH, TUNING, UI, WORKERS } from '../src/lib/xr/templates/bistroData.ts';

const tree = buildBistro();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);
const children = (id) => tree.filter((slot) => slot.parentId === id);
const rotate = (q, v) => {
	const [x, y, z, w] = q;
	const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
	return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};
const ROOMS = [
	{ name: 'lobby', min: [LOBBY.minX, LOBBY.minZ], max: [LOBBY.maxX, LOBBY.maxZ] },
	{ name: 'hall', min: [HALL.minX, HALL.minZ], max: [HALL.minX + HALL.w, HALL.minZ + HALL.d] },
	{ name: 'porch', min: [PORCH.minX, PORCH.minZ], max: [PORCH.maxX, PORCH.maxZ] }
];
const roomAt = (x, z) => ROOMS.find((room) => x > room.min[0] && x < room.max[0] && z > room.min[1] && z < room.max[1]);
const isFloor = (slot) => ['ground', 'disc'].includes(find(slot, 'meshRenderer')?.meshRef.id);
const floorUnder = (x, z) => tree.find((slot) => isFloor(slot) && slot.parentId === null && Math.abs(slot.position[1]) < 0.02 && Math.abs(x - slot.position[0]) <= 10 * slot.scale[0] && Math.abs(z - slot.position[2]) <= 10 * slot.scale[2]);

test('Bistro Rush is a valid scene: unique ids, known parents, built-in meshes, real numbers, within the limits of a world', () => {
	assert.equal(byId.size, tree.length, 'ids are unique');
	assert.ok(tree.length > 600 && tree.length < 1700, `${tree.length} slots`);
	assert.ok(JSON.stringify(tree).length < 1_500_000, 'under the size a world may be');
	for (const slot of tree) {
		assert.ok(slot.position.length === 3 && slot.position.every(Number.isFinite), `${slot.id} is somewhere`);
		assert.ok(slot.scale.length === 3 && slot.scale.every((v) => Number.isFinite(v) && v > 0), `${slot.id} has a size`);
		assert.ok(slot.rotation.length === 4 && Math.abs(Math.hypot(...slot.rotation) - 1) < 1e-4, `${slot.id} is turned by a unit quaternion`);
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id), `${slot.id} uses a built-in mesh`);
		assert.equal(new Set(slot.components.map((c) => c.type)).size, slot.components.length, `${slot.id} has one component of each type`);
		for (const type of ['textDisplay', 'scoreboard']) if (find(slot, type)) assert.equal(mesh?.meshRef.id, 'plane', `${slot.id} is drawn on a plane`);
		if (find(slot, 'uiPanel')) assert.equal(mesh, undefined, `${slot.id}: a panel makes its own plane`);
		const grab = find(slot, 'grabbable');
		if (grab) assert.ok(typeof grab.scalable === 'boolean' && typeof grab.autoGrip === 'boolean', `${slot.id} says how it is held`);
	}
	assert.equal(tree.filter((slot) => find(slot, 'skybox')).length, 1, 'one sky');
	assert.equal(tree.filter((slot) => find(slot, 'spawnPoint')).length, 1, 'one way in');
});

test('parents that group things are not scaled, so nothing below them is squashed', () => {
	for (const slot of tree) if (children(slot.id).length) assert.deepEqual(slot.scale, [1, 1, 1], `${slot.id} has children and a scale`);
});

test('every room has a floor that can be walked on and teleported to, and the players arrive on one', () => {
	// In a headset a player stands only on a `ground` or a `disc`: a box, however flat, is fallen through.
	for (let x = LOBBY.minX + 0.5; x < LOBBY.maxX; x += 1) for (let z = LOBBY.minZ + 0.5; z < LOBBY.maxZ; z += 1) assert.ok(floorUnder(x, z), `lobby floor at ${x}, ${z}`);
	for (let gx = 0; gx < HALL.w; gx++) for (let gz = 0; gz < HALL.d; gz++) assert.ok(floorUnder(HALL.minX + gx + 0.5, HALL.minZ + gz + 0.5), `hall floor in cell ${gx}, ${gz}`);
	for (let x = PORCH.minX + 0.3; x < PORCH.maxX; x += 0.6) for (let z = PORCH.minZ + 0.3; z < PORCH.maxZ; z += 0.6) assert.ok(floorUnder(x, z), `porch floor at ${x}, ${z}`);
	// The doorways too: the walls are thick.
	for (const z of [-0.45, -0.25, -0.05, HALL.d + 0.05, HALL.d + 0.25]) assert.ok(floorUnder(0, z), `floor in the doorway at z ${z}`);
	const spawn = tree.find((slot) => find(slot, 'spawnPoint'));
	assert.equal(roomAt(spawn.position[0], spawn.position[2])?.name, 'lobby');
	assert.ok(floorUnder(spawn.position[0], spawn.position[2]));
	assert.deepEqual(rotate(spawn.rotation, [0, 0, 1]), [0, 0, 1], 'looking at the kitchen door');
	for (const slot of tree) {
		if (!find(slot, 'collider') || isFloor(slot) || slot.parentId !== null) continue;
		const clear = Math.abs(slot.position[0] - spawn.position[0]) > slot.scale[0] / 2 + 0.8 || Math.abs(slot.position[2] - spawn.position[2]) > slot.scale[2] / 2 + 0.8;
		assert.ok(clear, `${slot.id} is not where the players arrive`);
	}
});

test('the rooms are closed: a wall on every side, with a doorway where there is a door', () => {
	const solid = tree.filter((slot) => find(slot, 'collider') && find(slot, 'meshRenderer') && !isFloor(slot) && slot.parentId === null && !find(slot, 'grabbable'));
	const blocked = (x, y, z) => solid.some((s) => Math.abs(x - s.position[0]) <= s.scale[0] / 2 && Math.abs(y - s.position[1]) <= s.scale[1] / 2 && Math.abs(z - s.position[2]) <= s.scale[2] / 2);
	// Walk round the outside of each room at knee and chest height, the heights the engine tests.
	for (const y of [0.45, 1.2]) {
		for (let x = LOBBY.minX; x <= LOBBY.maxX; x += 0.25) {
			assert.ok(blocked(x, y, LOBBY.minZ - 0.15), `lobby south wall at x ${x}`);
			if (Math.abs(x) > 0.95) assert.ok(blocked(x, y, LOBBY.maxZ + 0.2), `wall between lobby and hall at x ${x}`);
		}
		for (let z = LOBBY.minZ; z <= LOBBY.maxZ; z += 0.25) for (const x of [LOBBY.minX - 0.15, LOBBY.maxX + 0.15]) assert.ok(blocked(x, y, z), `lobby side wall at z ${z}`);
		for (let z = 0; z <= HALL.d; z += 0.25) for (const x of [HALL.minX - 0.15, HALL.minX + HALL.w + 0.15]) assert.ok(blocked(x, y, z), `hall side wall at z ${z}`);
		for (let x = HALL.minX; x <= HALL.minX + HALL.w; x += 0.25) if (Math.abs(x) > 0.95) assert.ok(blocked(x, y, HALL.d + 0.15), `hall north wall at x ${x}`);
		for (let x = PORCH.minX; x <= PORCH.maxX; x += 0.25) assert.ok(blocked(x, y, PORCH.maxZ + 0.15), `porch end wall at x ${x}`);
		for (let z = PORCH.minZ + 0.1; z <= PORCH.maxZ; z += 0.25) for (const x of [PORCH.minX - 0.15, PORCH.maxX + 0.15]) assert.ok(blocked(x, y, z), `porch side wall at z ${z}`);
		// The doorways are open, 1.6 m at least.
		for (const x of [-0.75, 0, 0.75]) assert.ok(!blocked(x, y, HALL.d + 0.15), `the street door is open at x ${x}`);
	}
	// The door to the lobby starts shut: it opens when a restaurant does.
	const leaves = [ID.doorLeaf('l'), ID.doorLeaf('r')].map((id) => byId.get(`${id}-leaf`));
	for (const leaf of leaves) assert.ok(find(leaf, 'collider') && !find(byId.get(leaf.parentId), 'grabbable'));
	const span = leaves.map((leaf) => byId.get(leaf.parentId).position[0]).sort((a, b) => a - b);
	assert.ok(span[0] < 0 && span[1] > 0 && leaves.every((leaf) => leaf.scale[0] > 0.7), 'two leaves across the doorway');
});

test('every sign and screen on a wall is turned to the room, at a height it can be read', () => {
	for (const slot of tree) {
		const text = find(slot, 'textDisplay') || find(slot, 'scoreboard') || find(slot, 'uiPanel');
		if (!text || (slot.parentId !== null && slot.parentId !== ID.root) || slot.position[1] < -100) continue;
		// A plane is read from its -z side: half a metre that way there has to be a room, and behind it there is not much.
		const out = rotate(slot.rotation, [0, 0, -1]);
		if (Math.abs(out[1]) > 0.9) continue; // lying flat on a surface
		const front = roomAt(slot.position[0] + out[0] * 0.5, slot.position[2] + out[2] * 0.5);
		assert.ok(front, `${slot.id} faces a room`);
		assert.equal(roomAt(slot.position[0] - out[0] * 0.35, slot.position[2] - out[2] * 0.35), undefined, `${slot.id} hangs on a wall`);
		assert.ok(slot.position[1] > 1.2 && slot.position[1] < 3.1, `${slot.id} is at ${slot.position[1]} m`);
	}
});

test('every screen is laid out within its panel, and every element has a size', () => {
	const element = (slot) => find(slot, 'uiElement');
	for (const panel of tree.filter((slot) => find(slot, 'uiPanel'))) {
		const { width, height } = find(panel, 'uiPanel');
		const direct = children(panel.id).filter(element);
		assert.ok(direct.length > 0, `${panel.id} has something on it`);
		const used = direct.reduce((sum, slot) => sum + element(slot).height + 2 * (element(slot).margin ?? 0), 0);
		assert.ok(used <= height, `${panel.id}: ${used} px of rows in ${height}`);
		const check = (slot) => {
			const e = element(slot);
			assert.ok(e.width > 0 && e.height > 0, `${slot.id} has a width and a height`);
			assert.ok(e.width <= width, `${slot.id} is no wider than its panel`);
			if (e.kind === 'text' || e.kind === 'button') assert.ok(e.fontSize >= 18, `${slot.id}: text of ${e.fontSize} px cannot be read in a headset`);
			const inside = children(slot.id).filter(element);
			if (!inside.length) return;
			const gap = (e.gap ?? 0) * (inside.length - 1), pad = 2 * (e.padding ?? 0);
			if (e.flexDirection === 'row') assert.ok(inside.reduce((sum, c) => sum + element(c).width, 0) + gap + pad <= e.width, `${slot.id}: its row fits`);
			else assert.ok(inside.reduce((sum, c) => sum + element(c).height, 0) + gap + pad <= e.height, `${slot.id}: its column fits`);
			for (const c of inside) { assert.ok(element(c).height <= e.height && element(c).width <= e.width, `${c.id} fits in ${slot.id}`); check(c); }
		};
		for (const slot of direct) check(slot);
	}
});

test('a press on any button reaches the director: every screen with buttons hangs below it', () => {
	for (const slot of tree) {
		if (find(slot, 'uiElement')?.kind !== 'button') continue;
		let top = slot;
		while (!find(top, 'uiPanel')) top = byId.get(top.parentId);
		assert.equal(top.parentId, ID.root, `${slot.id} is on a screen under the director`);
	}
	const buttons = [UI.seedPrev, UI.seedNext, UI.sizePrev, UI.sizeNext, UI.dishPrev, UI.dishNext, UI.start, UI.resume, UI.open, UI.close, UI.reroll, ...Array.from({ length: TUNING.offers }, (_, i) => UI.shopBuy(i))];
	for (const id of buttons) assert.equal(find(byId.get(id), 'uiElement').kind, 'button', `${id} is a button`);
	assert.ok(find(byId.get('bi-lobby-link'), 'worldLink'), 'and there is a way back to the main lobby');
});

test('the scripts compile, and every slot they name exists', () => {
	const scripts = tree.filter((slot) => find(slot, 'codeBlock'));
	assert.equal(scripts.length, 1 + MODELS.board, 'the director and one small script to a knife');
	for (const slot of scripts) assert.doesNotThrow(() => new Function('ctx', find(slot, 'codeBlock').code), `${slot.id}'s script is valid`);
	const director = find(byId.get(ID.root), 'codeBlock').code;
	const known = [...byId.keys()];
	for (const match of director.matchAll(/'(bi-[a-z0-9-]+)'/g)) assert.ok(byId.has(match[1]) || known.some((id) => id.startsWith(match[1])), `the director names ${match[1]}`);
	assert.ok(find(byId.get(ID.flush), 'scriptState'));
});

test('everything the script brings in waits out of sight, and is made as the script expects', () => {
	for (const [model, count] of Object.entries(MODELS)) {
		for (let n = 0; n < count; n++) {
			const id = ID.station(model, n);
			const root = byId.get(id);
			assert.ok(root && root.position[1] <= -100, `${id} is parked`);
			// The script makes an appliance something to carry only while the restaurant is closed.
			assert.equal(find(root, 'grabbable'), undefined, `${id} is furniture until the script says otherwise`);
			assert.ok(children(id).some((part) => find(part, 'collider')), `${id} stops the cook`);
			assert.ok(byId.has(`${id}-grab`), `${id} has its knob`);
			if (WORKERS.includes(model)) for (const key of ['gauge', 'fill', 'fx']) assert.ok(byId.has(`${id}-${key}`), `${id} has its ${key}`);
			if (model === 'hob' || model === 'pot') assert.ok(byId.has(`${id}-flame`));
			if (model === 'table') assert.ok(find(byId.get(`${id}-number`), 'textDisplay'));
		}
	}
	for (const kind of Object.values(KINDS)) if (kind.trim) for (let n = 0; n < MODELS[kind.model]; n++) assert.ok(byId.has(`${ID.station(kind.model, n)}-trim`), `${kind.name} can show its trim`);
	for (let n = 0; n < TUNING.items; n++) {
		assert.ok(find(byId.get(ID.item(n)), 'grabbable') && byId.get(ID.item(n)).position[1] <= -100);
		for (const part of PARTS) assert.ok(byId.has(`${ID.item(n)}-${part}`));
	}
	for (let n = 0; n < TUNING.platesMax; n++) assert.ok(find(byId.get(ID.plate(n)), 'grabbable') && byId.has(`${ID.plate(n)}-dirt-b`));
	for (let n = 0; n < MODELS.board; n++) assert.ok(find(byId.get(ID.knife(n)), 'grabbable') && find(byId.get(ID.knife(n)), 'scriptState'));
	for (let n = 0; n < TUNING.guests; n++) {
		assert.ok(byId.get(ID.guest(n)).position[1] <= -100);
		for (const key of ['bubble', 'bubble-name', 'bubble-chip-2', 'bubble-bar']) assert.ok(byId.has(`${ID.guest(n)}-${key}`));
	}
	for (let n = 0; n < TUNING.markers; n++) assert.ok(byId.get(ID.marker(n)).position[1] <= -100);
	for (let n = 0; n < DIVIDERS; n++) assert.ok(byId.get(ID.divider(n)).position[1] <= -100);
	for (let n = 0; n < TUNING.hearts; n++) assert.equal(byId.get(ID.heart(n)).parentId, ID.rail);
	for (const id of [ID.tiles, ID.rail, ID.partition('w'), ID.partition('e')]) assert.ok(byId.get(id).position[1] <= -100, `${id} is parked`);
	assert.ok(isFloor(byId.get(ID.tiles)), 'the kitchen tiles are a floor too');
});

test('every look uses the five shapes an ingredient has, at a size a hand can find', () => {
	for (const [key, look] of Object.entries(LOOKS)) {
		assert.ok(Object.keys(look).length > 0, `${key} is something`);
		for (const [part, d] of Object.entries(look)) {
			assert.ok(PARTS.includes(part), `${key}: ${part}`);
			assert.ok(d.scale.every((v) => v > 0.001 && v < 0.3) && d.at.every((v) => Math.abs(v) < 0.12), `${key}: ${part} is the size of food`);
			assert.match(d.color, /^#[0-9a-f]{6}$/);
		}
	}
});

test('the world is listed with the other worlds, and its lighting can be baked', async () => {
	const worlds = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.match(worlds, /id: 'bistro-rush',\s+name: 'Bistro Rush'/);
	assert.match(worlds, /DEV_WORLD_IDS[^\n]*'bistro-rush'/);
	const bake = await readFile(new URL('../scripts/bake-world.mjs', import.meta.url), 'utf8');
	assert.match(bake, /'bistro-rush'/);
});
