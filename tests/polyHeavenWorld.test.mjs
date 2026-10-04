import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { POLY_HAVEN_WORLD, buildPolyHeavenMaterials, loadPolyHavenLogic } from '../src/lib/xr/templates/polyHeavenMaterials.ts';
import { MATERIAL_ORB_TAG, ORB_PREVIEW_SIZE, buildMaterialOrb } from '../src/lib/xr/templates/materialOrb.ts';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

const logic = loadPolyHavenLogic();
const tree = buildPolyHeavenMaterials();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const FILES = {
	Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/file/x/brick_diffuse_1k.jpg' }, png: { url: 'https://dl.polyhaven.org/file/x/brick_diffuse_1k.png' } }, '2k': { jpg: { url: 'https://dl.polyhaven.org/file/x/brick_diffuse_2k.jpg' } } },
	nor_gl: { '2k': { png: { url: 'https://dl.polyhaven.org/file/x/brick_nor_gl_2k.png' } } },
	nor_dx: { '1k': { jpg: { url: 'https://dl.polyhaven.org/file/x/brick_nor_dx_1k.jpg' } } },
	arm: { '1k': { jpg: { url: 'http://insecure.example/brick_arm_1k.jpg' } } }
};

test('the world is registered as a development world', async () => {
	const source = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.ok(/DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1].includes('polyheaven-materials'));
	assert.match(source, /id: 'polyheaven-materials'/);
	assert.match(source, /name: 'PolyHeaven materials'/);
});

test('the scene is valid: unique ids, known parents, built-in meshes', () => {
	assert.equal(byId.size, tree.length);
	for (const slot of tree) {
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id));
	}
	assert.ok(find(byId.get(POLY_HAVEN_WORLD.panelId), 'codeBlock'));
	assert.equal(tree.filter((slot) => /^ph-row-\d+$/.test(slot.id)).length, POLY_HAVEN_WORLD.rows);
});

test('both scripts compile', () => {
	for (const id of [POLY_HAVEN_WORLD.panelId, POLY_HAVEN_WORLD.toolId]) {
		const { code } = find(byId.get(id), 'codeBlock');
		assert.doesNotThrow(() => new Function('ctx', `return (function () {${code}\n})();`), id);
	}
});

test('the credit to Poly Haven is on the panel and on a sign', () => {
	assert.match(byId.get('ph-credit').components[0].text, /Poly Haven/);
	assert.match(find(byId.get('ph-credits'), 'textDisplay').title, /Poly Haven/);
});

test('urls ask for textures and escape the search', () => {
	assert.equal(logic.assetsUrl(), 'https://api.polyhaven.com/assets?type=textures');
	const url = new URL(logic.searchUrl(' red brick & "moss" '));
	assert.equal(url.origin + url.pathname, 'https://api.polyhaven.com/search');
	assert.equal(url.searchParams.get('q'), 'red brick & "moss"');
	assert.equal(url.searchParams.get('t'), 'textures');
	assert.equal(logic.filesUrl('a/b'), 'https://api.polyhaven.com/files/a%2Fb');
});

test('the list is read most downloaded first, with a thumbnail for each', () => {
	const list = logic.parseAssets({
		a: { name: 'A', categories: ['wood', 'floor'], download_count: 5, dimensions: [2000, 2000], thumbnail_url: 'https://cdn.polyhaven.com/t/a.png?w=1&amp;h=1' },
		b: { name: 'B', download_count: 50 },
		c: null
	});
	assert.deepEqual(list.map((entry) => entry.id), ['b', 'a']);
	assert.equal(list[1].thumb, 'https://cdn.polyhaven.com/t/a.png?w=1&h=1');
	assert.equal(list[1].category, 'wood');
	assert.equal(list[1].size, 2, 'the real size comes in millimetres');
	assert.equal(list[0].size, 1, 'a texture with no size covers a metre');
	assert.match(list[0].thumb, /^https:\/\/cdn\.polyhaven\.com\/asset_img\/thumbs\/b\.png/);
	assert.deepEqual(logic.parseAssets(null), []);
});

test('a search answer is only the ids, best first', () => {
	assert.deepEqual(logic.parseSearch({ results: [{ slug: 'x', score: 1 }, { score: 0.5 }, { slug: 'y' }] }), ['x', 'y']);
	assert.deepEqual(logic.parseSearch(undefined), []);
});

test('the maps are the smallest size that has them, https only, with colour variants as a fallback', () => {
	assert.deepEqual(logic.pickMaps(FILES), {
		albedo: 'https://dl.polyhaven.org/file/x/brick_diffuse_1k.jpg',
		normal: 'https://dl.polyhaven.org/file/x/brick_nor_gl_2k.png',
		arm: ''
	});
	assert.equal(logic.pickMaps({ col_1: { '2k': { jpg: { url: 'https://a.test/c.jpg' } } } }).albedo, 'https://a.test/c.jpg');
	assert.deepEqual(logic.pickMaps({}), { albedo: '', normal: '', arm: '' });
	assert.deepEqual(logic.pickMaps(null), { albedo: '', normal: '', arm: '' });
});

test('a material orb is a grabbable sphere with the material, that a material socket takes', () => {
	const albedo = { kind: 'url', url: 'https://a.test/x.jpg' };
	const slots = buildMaterialOrb({ id: 'o', label: 'Brick', albedo, size: 2 });
	const [root] = slots;
	assert.equal(find(root, 'meshRenderer').meshRef.id, 'sphere');
	assert.deepEqual(find(root, 'material'), { type: 'material', albedo, mapping: 'world', size: ORB_PREVIEW_SIZE, label: 'Brick' }, 'the orb shows a few repeats, by its own size');
	assert.deepEqual(find(root, 'scriptState').data, { size: 2 }, 'the real size is kept for the tool');
	assert.equal(find(root, 'insertable').tag, MATERIAL_ORB_TAG);
	assert.ok(find(root, 'grabbable') && find(root, 'collider'));
	assert.ok(slots.some((slot) => find(slot, 'previewCamera')));
	assert.equal(find(slots.find((slot) => slot.name === 'Material Label'), 'textDisplay').title, 'Brick');
	const socket = find(byId.get(`${POLY_HAVEN_WORLD.toolId}-socket`), 'socket');
	assert.deepEqual(socket.accepts, [MATERIAL_ORB_TAG]);
});

test('the applicator is an equippable tool with a socket, a muzzle and a laser script', () => {
	const tool = byId.get(POLY_HAVEN_WORLD.toolId);
	assert.ok(find(tool, 'grabbable') && find(tool, 'equippable'));
	const parts = tree.filter((slot) => slot.parentId === tool.id).map((slot) => slot.name);
	assert.ok(parts.includes('Muzzle') && parts.includes(POLY_HAVEN_WORLD.socketName));
});

test('pressing a material spawns an orb whose maps are the library’s own addresses', async () => {
	const { code } = find(byId.get(POLY_HAVEN_WORLD.panelId), 'codeBlock');
	const spawned = [];
	const fields = new Map();
	const requested = [];
	const ctx = {
		net: {
			fetchJson: async (url) => {
				requested.push(url);
				if (url.includes('/assets')) return { brick: { name: 'Red "Brick"', categories: ['wall'], download_count: 9 }, wood: { name: 'Wood', download_count: 1 } };
				if (url.includes('/search')) return { results: [{ slug: 'wood' }, { slug: 'gone' }] };
				return FILES;
			}
		},
		hierarchy: { getSlot: () => null },
		world: { spawn: (slot) => spawned.push(slot), deleteSlot: () => {}, setComponentField: (id, type, field, value) => fields.set(`${id}.${field}`, value) }
	};
	const handlers = new Function('ctx', `return (function () {${code}\n})();`)(ctx);
	handlers.onSpawn();
	await tick();
	assert.equal(fields.get('ph-row-0.text').startsWith('Red "Brick"'), true);
	assert.equal(fields.get('ph-row-1.text').startsWith('Wood'), true);
	assert.equal(fields.get('ph-row-2.visible'), false);
	assert.match(fields.get('ph-thumb-0.src'), /^https:\/\/cdn\.polyhaven\.com/);

	handlers.onUIEvent({ type: 'change', slotId: POLY_HAVEN_WORLD.inputId, text: 'wood' });
	handlers.onUIEvent({ type: 'press', slotId: POLY_HAVEN_WORLD.searchId });
	await tick();
	assert.equal(fields.get('ph-row-0.text').startsWith('Wood'), true);
	assert.equal(fields.get('ph-row-1.visible'), false, 'an id the library list does not know is left out');

	handlers.onUIEvent({ type: 'press', slotId: 'ph-row-0' });
	await tick();
	assert.ok(requested.some((url) => url.endsWith('/files/wood')));
	const root = spawned.find((slot) => slot.parentId === null);
	const material = find(root, 'material');
	assert.deepEqual(material.albedo, { kind: 'url', url: 'https://dl.polyhaven.org/file/x/brick_diffuse_1k.jpg' });
	assert.deepEqual(material.normal, { kind: 'url', url: 'https://dl.polyhaven.org/file/x/brick_nor_gl_2k.png' });
	assert.equal(find(root, 'scriptState').data.size, 1, 'a texture with no size is a metre');
	assert.equal(material.arm, undefined, 'a map that is not https is not used');
	assert.equal(find(root, 'insertable').tag, MATERIAL_ORB_TAG);
	assert.ok(spawned.every((slot) => slot.id.startsWith('ph-orb-')));
	assert.equal(new Set(spawned.map((slot) => slot.id)).size, spawned.length);
	assert.ok(!/__(ID|LABEL)__/.test(JSON.stringify(spawned)), 'no token is left');
});

/** Runs the applicator's script against a fake world: its own parts, one orb in the socket, one thing aimed at. */
function applicator({ occupant, target }) {
	const { code } = find(byId.get(POLY_HAVEN_WORLD.toolId), 'codeBlock');
	const toolId = POLY_HAVEN_WORLD.toolId;
	const slots = new Map(tree.map((slot) => [slot.id, structuredClone(slot)]));
	if (occupant) {
		slots.get(`${toolId}-socket`).components[0].occupantId = occupant.id;
		slots.set(occupant.id, occupant);
	}
	if (target) slots.set(target.id, target);
	const applied = [];
	const sounds = [];
	const rays = [];
	const ctx = {
		self: { id: toolId, getWorldPosition: () => [0, 0, 0], getWorldRotation: () => [0, 0, 0, 1] },
		hierarchy: {
			getSlot: (id) => slots.get(id) ?? null,
			getChildren: (id) => [...slots.values()].filter((slot) => slot.parentId === id),
			getParent: (id) => slots.get(slots.get(id)?.parentId) ?? null,
			getWorldPose: () => ({ position: [0, 1, 0], forward: [0, 0, 1], rotation: [0, 0, 0, 1] })
		},
		world: {
			raycast: (origin, direction, reach, options) => { rays.push(options); return target ? { slotId: target.id, point: [0, 1, 3] } : null; },
			setComponent: (id, component) => { applied.push([id, component]); return true; },
			isHost: () => true,
			spawn() {}, deleteSlot() {}, setComponentField() {}, setWorldPose: () => false
		},
		math: { vecAdd: (a, b) => a.map((v, i) => v + b[i]), vecScale: (a, k) => a.map((v) => v * k), vecSub: (a, b) => a.map((v, i) => v - b[i]), vecLength: (a) => Math.hypot(...a), quatFromAxisAngle: () => [0, 0, 0, 1] },
		audio: { play: (sound) => sounds.push(sound) },
		grab: { isHeld: () => true },
		equip: { isEquipped: () => false },
		log() {}
	};
	const handlers = new Function('ctx', `return (function () {${code}\n})();`)(ctx);
	return { handlers, applied, sounds, rays };
}

const orb = (id = 'orb') => ({ id, parentId: `${POLY_HAVEN_WORLD.toolId}-socket`, name: 'Orb', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [0.12, 0.12, 0.12], components: [{ type: 'insertable', tag: 'material' }, { type: 'material', albedo: { kind: 'url', url: 'https://a.test/x.jpg' }, mapping: 'world', size: 0.15, label: 'Brick' }, { type: 'scriptState', data: { size: 0.5 } }] });
const thing = (components, extra = {}) => ({ id: 'thing', parentId: null, name: 'Thing', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, ...components], ...extra });

test('the trigger puts the orb’s material on what the laser points at, laid out by real size', () => {
	const wall = thing([], { scale: [6, 2.4, 0.2] });
	const { handlers, applied, rays } = applicator({ occupant: orb(), target: wall });
	handlers.onTrigger({ phase: 'press', hand: 'right' });
	assert.deepEqual(rays[0], { ignore: [POLY_HAVEN_WORLD.toolId] }, 'the ray passes through the tool and the orb it holds');
	assert.equal(applied.length, 1);
	assert.equal(applied[0][0], 'thing');
	assert.deepEqual(applied[0][1].albedo, { kind: 'url', url: 'https://a.test/x.jpg' });
	assert.equal(applied[0][1].mapping, 'world', 'the repeats follow the real size, not the mesh');
	assert.equal(applied[0][1].size, 0.5, 'the real size the orb keeps, not the size it shows itself at');
	assert.equal(applied[0][1].label, 'Brick');
});

test('nothing is applied with an empty socket, or to a tool, an orb, a model or a panel', () => {
	const cases = [
		{ occupant: null, target: thing([]) },
		{ occupant: orb(), target: thing([{ type: 'grabbable', scalable: true }, { type: 'equippable', left: {}, right: {} }]) },
		{ occupant: orb(), target: thing([{ type: 'insertable', tag: 'material' }]) },
		{ occupant: orb(), target: thing([{ type: 'uiPanel', width: 1, height: 1 }]) },
		{ occupant: orb(), target: { ...thing([]), components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: `sha256:${'a'.repeat(64)}` } }] } },
		{ occupant: orb(), target: null }
	];
	for (const [index, scene] of cases.entries()) {
		const { handlers, applied, sounds } = applicator(scene);
		handlers.onTrigger({ phase: 'press', hand: 'right' });
		assert.equal(applied.length, 0, `case ${index}`);
		assert.equal(sounds.length, 1, `case ${index} buzzes`);
	}
});

test('the trigger release does nothing, and an orb that is no longer in the socket does not count', () => {
	const { handlers, applied } = applicator({ occupant: orb(), target: thing([]) });
	handlers.onTrigger({ phase: 'release', hand: 'right' });
	assert.equal(applied.length, 0);
	const stale = { ...orb(), parentId: null };
	const run = applicator({ occupant: stale, target: thing([]) });
	run.handlers.onTrigger({ phase: 'press', hand: 'right' });
	assert.equal(run.applied.length, 0);
});

test('the room is captured as a reflection probe, so glossy materials have something to reflect', () => {
	const skybox = find(byId.get('ph-skybox'), 'skybox');
	assert.equal(skybox.reflectionCapture, true);
	assert.equal(skybox.toneMapping, 'aces');
	assert.ok(byId.get('ph-skybox').position[1] > 0.5, 'the probe is taken from the height of the table, not the floor');
});
