import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { AbstractMesh, MeshBuilder, NullEngine, Quaternion, Ray, Scene, TransformNode, UniversalCamera, Vector3, WebXRState } from '@babylonjs/core';
import { createSlot } from '../src/lib/ecs/types.ts';
import { runtimeUrl, buildCodeBlockCtx } from './helpers/codeBlockRuntimeModule.mjs';
import { LightVolumeManager } from '../src/lib/xr/lightVolumeManager.ts';

const coreUrl = import.meta.resolve('@babylonjs/core');
const libUrl = new URL('../src/lib/', import.meta.url);
function compile(source) {
	return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
		.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
		.replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
}
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const codeBlockUrl = runtimeUrl;
let graphCode = compile(await readFile(new URL('xr/sceneGraph.ts', libUrl), 'utf8'))
	.replaceAll("'./slotRebuild'", JSON.stringify(new URL('xr/slotRebuild.ts', libUrl).href))
	.replaceAll("'./playerPoses'", JSON.stringify(new URL('xr/playerPoses.ts', libUrl).href))
	.replaceAll("'./lightVolumeRenderer'", JSON.stringify(new URL('xr/lightVolumeRenderer.ts', libUrl).href))
	.replaceAll("'./lightVolumeManager'", JSON.stringify(new URL('xr/lightVolumeManager.ts', libUrl).href))
	.replaceAll("'./performance'", JSON.stringify(new URL('xr/performance.ts', libUrl).href))
	.replaceAll("'./codeBlockRuntime'", JSON.stringify(codeBlockUrl));
// These tests exercise real scene nodes, picking, scripts and collisions without creating DOM/media surfaces.
// Fail explicitly if a fixture accidentally asks for one of those browser-only renderers.
graphCode = graphCode.replace(/import \{ (setup\w+) \} from '\.\/[^']+';/g,
	(_, name) => `const ${name} = () => { throw new Error('Unexpected browser surface: ${name}'); };`);
const { SceneGraph } = await import(moduleUrl(graphCode));
const { setupPlayerBody } = await import(moduleUrl(compile(await readFile(new URL('xr/interaction/playerBody.ts', libUrl), 'utf8'))));
const { GrabSystem } = await import(moduleUrl(compile(await readFile(new URL('xr/interaction/grabSystem.ts', libUrl), 'utf8'))));

const assetId = `sha256:${'1'.repeat(64)}`;

test('local script animation updates the node without overwriting its authored transform', () => {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const graph = new SceneGraph(scene, {});
	try {
		const authored = createSlot({ id: 'animated', name: 'Animated Group', position: [1, 2, 3], components: [{ type: 'codeBlock', code: `
			return { tick() {
				ctx.self.setLocalTransform({position:[4,5,6],rotation:[0,0,1,0],scale:[2,3,4]});
				ctx.self.setLocalTransform({position:[NaN,0,0],scale:[0,Infinity,-1]});
			} };
		` }] });
		graph.load([authored]);
		const entry = graph.getLive('animated');
		entry.runtime.tick(1 / 72);
		assert.deepEqual(entry.node.position.asArray(), [4, 5, 6]);
		assert.deepEqual(entry.node.scaling.asArray(), [2, 3, 4]);
		assert.deepEqual(entry.node.rotationQuaternion.asArray(), [0, 0, 1, 0]);
		assert.deepEqual(entry.slot.position, [1, 2, 3]);
		assert.deepEqual(entry.slot.scale, [1, 1, 1]);
		assert.deepEqual(graph.getCodeBlockDebugLog('animated'), []);
	} finally { graph.dispose(); scene.dispose(); engine.dispose(); }
});

test('self-lit primitives keep their color without lights and accept live color edits', () => {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const graph = new SceneGraph(scene, {});
	try {
		graph.load([createSlot({ id: 'star', name: 'Star', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#ffe6b0', unlit: true }] })]);
		const mesh = graph.getLive('star').node;
		assert.equal(mesh.material.disableLighting, true);
		assert.equal(mesh.material.emissiveColor.toHexString().toLowerCase(), '#ffe6b0');
		graph.setComponentField('star', 'meshRenderer', 'color', '#72d6d3');
		assert.equal(mesh.material.emissiveColor.toHexString().toLowerCase(), '#72d6d3');
	} finally { graph.dispose(); scene.dispose(); engine.dispose(); }
});

function fixture() {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const camera = new UniversalCamera('viewer', new Vector3(0, 1.6, -4), scene);
	scene.activeCamera = camera;
	return { engine, scene, camera, dispose() { scene.dispose(); engine.dispose(); } };
}
function modelLibrary(scene) {
	let notify;
	const lease = {
		state: 'pending', extents: [1, 1, 1], released: false,
		setPriority() {}, release() { this.released = true; },
		instantiate(name) {
			const root = new TransformNode(name, scene);
			const mesh = MeshBuilder.CreateBox(`${name}-geometry`, {}, scene);
			mesh.parent = root;
			mesh.isPickable = false;
			return { root, extents: [1, 1, 1], boneNodes: new Map(), dispose() { root.dispose(); } };
		}
	};
	return { lease, acquire(_, onChange) { notify = onChange; return lease; }, ready() { lease.state = 'ready'; notify(); } };
}

test('model containers stay outside the mesh list while their proxies remain pickable and movable', () => {
	const f = fixture();
	const models = modelLibrary(f.scene);
	const graph = new SceneGraph(f.scene, { models });
	try {
		const parent = createSlot({ id: 'parent', position: [2, 0, 0] });
		const slot = createSlot({ id: 'model', parentId: 'parent', components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId } }] });
		graph.load([slot, parent]); // the parent may arrive after its child
		const entry = graph.getLive(slot.id);
		assert.ok(entry.node instanceof TransformNode);
		assert.ok(!(entry.node instanceof AbstractMesh));
		assert.equal(f.scene.meshes.includes(entry.node), false);
		assert.equal(entry.node.metadata.selectionMesh, entry.model.proxy);
		models.ready();
		assert.equal(entry.model.placeholder.isEnabled(), false);
		const pick = (x) => {
			for (const mesh of f.scene.meshes) mesh.computeWorldMatrix(true);
			return f.scene.pickWithRay(new Ray(new Vector3(x, 0, -4), Vector3.Forward(), 8));
		};
		assert.equal(graph.getSlotIdForNode(pick(2).pickedMesh), slot.id);
		graph.applyTransforms([{ id: slot.id, position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }]);
		assert.equal(pick(2).hit, false);
		assert.equal(graph.getSlotIdForNode(pick(3).pickedMesh), slot.id);
		graph.removeSlot(slot.id);
		assert.equal(models.lease.released, true);
		assert.equal(f.scene.meshes.length, 0);
	} finally { graph.dispose(); f.dispose(); }
});

for (const shape of ['box', 'mesh']) {
	test(`model ${shape} colliders still block the player after loading into a TransformNode`, () => {
		const f = fixture();
		const models = modelLibrary(f.scene);
		const graph = new SceneGraph(f.scene, { models });
		try {
			graph.load([createSlot({ id: 'solid', components: [
				{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId } },
				{ type: 'collider', shape }
			] })]);
			models.ready();
			f.camera.position.set(0, 1.6, -1.5);
			f.camera.realWorldHeight = 1.6;
			const xr = { baseExperience: { state: WebXRState.IN_XR, camera: f.camera } };
			const body = setupPlayerBody(f.scene, graph, xr, f.camera, { x: 0, z: 0 });
			const model = graph.getLive('solid').model;
			const target = shape === 'mesh' ? model.instance.root.getChildMeshes()[0] : model.proxy;
			assert.equal(target.checkCollisions, true);
			assert.equal(target.isPickable, true);
			assert.equal(model.placeholder.checkCollisions, false);
			for (const mesh of f.scene.meshes) mesh.computeWorldMatrix(true);
			assert.ok(body.constrainMove(new Vector3(0, 0, 1)).z < 1, 'walking into the model is constrained');
		} finally { graph.dispose(); f.dispose(); }
	});
}

test('bulk loading and reconciliation coalesce cleanup while pose snapshots keep materials untouched', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene);
	let clears = 0, materialUpdates = 0;
	const free = f.scene.freeActiveMeshes.bind(f.scene);
	f.scene.freeActiveMeshes = () => { if (!f.scene.blockfreeActiveMeshesAndRenderingGroups) clears++; free(); };
	const mark = f.scene.markAllMaterialsAsDirty.bind(f.scene);
	f.scene.markAllMaterialsAsDirty = (flag) => { if (!f.scene.blockMaterialDirtyMechanism) materialUpdates++; mark(flag); };
	try {
		const slots = Array.from({ length: 6 }, (_, i) => createSlot({ id: `box-${i}`, components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff' },
			{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 2 }
		] }));
		graph.load(slots);
		assert.equal(materialUpdates, 1);
		materialUpdates = 0;
		graph.reconcile(slots.map((slot) => ({ ...slot, position: [1, 2, 3] })));
		assert.equal(materialUpdates, 0, 'frequent pose snapshots do not invalidate all shaders');
		graph.reconcile([]);
		assert.equal(clears, 1, 'removing multiple independent roots performs one render-list cleanup');
		assert.equal(f.scene.blockMaterialDirtyMechanism, false);
		assert.equal(f.scene.blockfreeActiveMeshesAndRenderingGroups, false);
	} finally { graph.dispose(); f.dispose(); }
});

test('scripts can still move model roots after construction', () => {
	const f = fixture();
	const models = modelLibrary(f.scene);
	const graph = new SceneGraph(f.scene, { models });
	try {
		graph.load([createSlot({ id: 'scripted', components: [
			{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId } },
			{ type: 'codeBlock', code: 'return { tick(dt) { const p = ctx.self.getWorldPosition(); ctx.self.setWorldPosition([p[0] + dt, p[1], p[2]]); } };' }
		] })]);
		graph.tick(0.25);
		assert.deepEqual(graph.getCodeBlockDebugLog('scripted'), []);
		assert.equal(graph.getLive('scripted').node.position.x, 0.25);
	} finally { graph.dispose(); f.dispose(); }
});

function closeArray(actual, expected) {
	actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-5, `${value} differs from ${expected[i]} at ${i}`));
}

for (const parentId of [null, 'parent']) {
	test(`serializing a held object in ${parentId ? 'its slot parent' : 'world'} space never changes its live transform or hierarchy`, () => {
		const f = fixture();
		const graph = new SceneGraph(f.scene);
		try {
			graph.load([
				createSlot({ id: 'parent', position: [2, -1, 3], rotation: Quaternion.FromEulerAngles(0.2, 0.4, 0).asArray(), scale: [2, 2, 2] }),
				createSlot({ id: 'held', parentId, position: [1, 2, 3], rotation: Quaternion.FromEulerAngles(0.3, 0.1, 0.2).asArray(), scale: [-1, 1.5, 2] }),
				createSlot({ id: 'child', parentId: 'held', position: [0, 1, 0] })
			]);
			const node = graph.getLive('held').node;
			const hand = new TransformNode('hand', f.scene);
			hand.position.set(5, 2, -1);
			hand.rotationQuaternion = Quaternion.FromEulerAngles(0.1, 0.2, 0.6);
			node.setParent(hand);
			const reference = new TransformNode('reference', f.scene);
			reference.position.copyFrom(node.position);
			reference.scaling.copyFrom(node.scaling);
			reference.rotationQuaternion = node.rotationQuaternion.clone();
			reference.parent = hand;
			const localPose = [node.position.asArray(), node.rotationQuaternion.asArray(), node.scaling.asArray()];
			const children = hand.getChildren();
			node.setParent = () => { throw new Error('Reading a pose must not reparent the held object'); };
			for (let i = 0; i < 25; i++) {
				hand.position.x += 0.02;
				hand.rotationQuaternion.copyFrom(Quaternion.FromEulerAngles(0.1, 0.2 + i * 0.01, 0.6));
				reference.setParent(parentId ? graph.getLive(parentId).node : null);
				for (const snapshot of [graph.serializeSlot('held'), graph.serialize().find((slot) => slot.id === 'held')]) {
					closeArray(snapshot.position, reference.position.asArray());
					closeArray(snapshot.rotation, reference.rotationQuaternion.asArray());
					closeArray(snapshot.scale, reference.scaling.asArray());
				}
				assert.deepEqual([node.position.asArray(), node.rotationQuaternion.asArray(), node.scaling.asArray()], localPose);
				assert.equal(node.parent, hand);
				assert.equal(graph.getLive('child').node.parent, node);
				reference.parent = hand;
				reference.position.copyFrom(node.position);
				reference.rotationQuaternion.copyFrom(node.rotationQuaternion);
				reference.scaling.copyFrom(node.scaling);
			}
			assert.deepEqual(hand.getChildren(), children);
		} finally { graph.dispose(); f.dispose(); }
	});
}

test('two-point grabs move, rotate and scale without replacing the transform buffers, and release both hands', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene);
	try {
		graph.load([createSlot({ id: 'held', position: [0, 0, 3], components: [{ type: 'grabbable', scalable: true }] })]);
		const grab = new GrabSystem(f.scene, graph);
		const a = new TransformNode('left', f.scene), b = new TransformNode('right', f.scene);
		a.position.set(-1, 0, 0);
		b.position.set(1, 0, 0);
		a.computeWorldMatrix(true);
		b.computeWorldMatrix(true);
		grab.grab('left', a, 'held');
		grab.grab('right', b, 'held');
		const node = graph.getLive('held').node;
		const position = node.position, scale = node.scaling, rotation = node.rotationQuaternion;
		a.position.set(1, -2, 0);
		b.position.set(1, 2, 0);
		a.computeWorldMatrix(true);
		b.computeWorldMatrix(true);
		f.scene.onBeforeRenderObservable.notifyObservers(f.scene);
		closeArray(node.position.asArray(), [1, 0, 3]);
		closeArray(node.scaling.asArray(), [2, 2, 2]);
		closeArray(Vector3.Right().applyRotationQuaternion(node.rotationQuaternion).asArray(), [0, 1, 0]);
		assert.equal(node.position, position);
		assert.equal(node.scaling, scale);
		assert.equal(node.rotationQuaternion, rotation);
		grab.release('left');
		assert.equal(grab.isHolding('right'), false);
		assert.equal(node.parent, null);
		closeArray(node.position.asArray(), [1, 0, 3]);
	} finally { graph.dispose(); f.dispose(); }
});

test('leaving a world (reconciling to another scene) stops the tracks its scripts started, and a surface on the same slot is still disposed', async () => {
	const f = fixture();
	const tracks = [];
	const audio = { analyze: async () => ({}), playTrack: async () => { const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track); return track; } };
	const graph = new SceneGraph(f.scene, { audio });
	try {
		const music = createSlot({ id: 'music', components: [{ type: 'codeBlock', code: "return { async onSpawn() { await ctx.audio.playTrack({ kind: 'url', url: '/song.mp3' }); } };" }] });
		const other = createSlot({ id: 'other', position: [5, 0, 0], components: [] });
		graph.load([music, other]);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(tracks.length, 1);
		assert.equal(tracks[0].stopped, false, 'the song plays while its world is here');
		// Another world: the song's slot is gone.
		graph.reconcile([createSlot({ id: 'elsewhere' })]);
		assert.equal(tracks[0].stopped, true, 'the song stops with its world');
		// A world that keeps the slot keeps the song.
		const keeper = createSlot({ id: 'keeper', components: [{ type: 'codeBlock', code: "return { async onSpawn() { await ctx.audio.playTrack('x'); } };" }] });
		graph.reconcile([keeper]);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(tracks.length, 2);
		graph.reconcile([keeper, createSlot({ id: 'extra' })]);
		assert.equal(tracks[1].stopped, false, 'still the same world');
		// Disposing the whole graph (the engine shutting down) stops everything too.
		graph.dispose();
		assert.equal(tracks[1].stopped, true);
	} finally {
		f.dispose();
	}
});

test('a script can give another slot a component, but not code or identity', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([createSlot({ id: 'box', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ff0000' }] })]);
		assert.equal(graph.setComponent('box', { type: 'collider', shape: 'box' }), true);
		assert.ok(graph.getLive('box').slot.components.some((c) => c.type === 'collider'));
		assert.equal(graph.setComponent('box', { type: 'collider', shape: 'sphere' }), true);
		const colliders = graph.getLive('box').slot.components.filter((c) => c.type === 'collider');
		assert.deepEqual(colliders, [{ type: 'collider', shape: 'sphere' }], 'the component of that type is replaced, not added twice');
		assert.equal(graph.setComponent('box', { type: 'codeBlock', code: 'return {};' }), false);
		assert.equal(graph.setComponent('missing', { type: 'collider', shape: 'box' }), false);
	} finally { graph.dispose(); f.dispose(); }
});

test('the player holding a tool can take what sits in its socket, but not the tool or anyone else’s socket', async () => {
	const equipmentCode = compile(await readFile(new URL('xr/interaction/equipmentSystem.ts', libUrl), 'utf8'))
		.replaceAll("'./equipmentRegistry'", JSON.stringify(new URL('xr/interaction/equipmentRegistry.ts', libUrl).href))
		.replace(/import \{[^}]*\} from '\.\/grabSystem';/, '')
		.replace(/import \{ eulerToQuat \} from "[^"]+";/, 'const eulerToQuat = () => [0, 0, 0, 1];');
	const { EquipmentSystem } = await import(moduleUrl(equipmentCode));
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([
			createSlot({ id: 'tool', components: [{ type: 'grabbable', scalable: false }, { type: 'equippable', left: { position: [0, 0, 0], rotation: [0, 0, 0] }, right: { position: [0, 0, 0], rotation: [0, 0, 0] } }] }),
			createSlot({ id: 'socket', parentId: 'tool', components: [{ type: 'socket', accepts: ['material'], radius: 0.2, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, occupantId: 'orb' }] }),
			createSlot({ id: 'orb', parentId: 'socket', components: [{ type: 'grabbable', scalable: false }, { type: 'insertable', tag: 'material' }] }),
			createSlot({ id: 'loose', parentId: 'tool', components: [{ type: 'grabbable', scalable: false }] })
		]);
		const grabSystem = { setGuard() {} };
		const system = new EquipmentSystem(f.scene, graph, grabSystem, () => 'me', (id) => id);
		system.registry.equip('me', 'right', 'tool');
		assert.equal(system.canGrab('tool', 'left'), false, 'the equipped tool itself stays put');
		assert.equal(system.canGrab('orb', 'left'), true, 'its holder takes the orb out with the free hand');
		assert.equal(system.canGrab('orb', 'other:left'), false, 'another player cannot take it');
		assert.equal(system.canGrab('loose', 'left'), false, 'only what a socket holds, not any child');
	} finally { graph.dispose(); f.dispose(); }
});

test('trigger and equip events reach a script with the id the player announced, and the name found by the connection id', async () => {
	const equipmentCode = compile(await readFile(new URL('xr/interaction/equipmentSystem.ts', libUrl), 'utf8'))
		.replaceAll("'./equipmentRegistry'", JSON.stringify(new URL('xr/interaction/equipmentRegistry.ts', libUrl).href))
		.replace(/import \{[^}]*\} from '\.\/grabSystem';/, '')
		.replace(/import \{ eulerToQuat \} from "[^"]+";/, 'const eulerToQuat = () => [0, 0, 0, 1];');
	const { EquipmentSystem } = await import(moduleUrl(equipmentCode));
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const events = () => graph.getCodeBlockDebugLog('gun').map((entry) => JSON.parse(entry.message));
		graph.load([createSlot({ id: 'gun', components: [
			{ type: 'grabbable', scalable: false },
			{ type: 'equippable', left: { position: [0, 0, 0], rotation: [0, 0, 0] }, right: { position: [0, 0, 0], rotation: [0, 0, 0] } },
			{ type: 'codeBlock', code: 'return { onTrigger(e) { ctx.log(JSON.stringify(["trigger", e.playerId, e.playerName])); }, onUnequip(e) { ctx.log(JSON.stringify(["unequip", e.playerId, e.playerName])); } };' }
		] })]);
		const names = { 'conn-9': 'Ana', me: 'Host' };
		const system = new EquipmentSystem(f.scene, graph, { setGuard() {} }, () => 'me', (key) => names[key], (key) => (key === 'conn-9' ? 'announced-9' : key));
		system.registry.equip('conn-9', 'right', 'gun');
		system.dispatchTrigger('conn-9', 'right', 'press', 1, 'gun');
		system.unequip('conn-9', 'right');
		assert.deepEqual(events(), [['trigger', 'announced-9', 'Ana'], ['unequip', 'announced-9', 'Ana']]);
		const plain = new EquipmentSystem(f.scene, graph, { setGuard() {} }, () => 'me', (key) => key);
		plain.registry.equip('me', 'left', 'gun');
		plain.dispatchTrigger('me', 'left', 'press', 1, 'gun');
		assert.deepEqual(events().slice(2), [['trigger', 'me', 'me']], 'without a mapping the id is passed as it is');
	} finally { graph.dispose(); f.dispose(); }
});

test('a ray can pass through some slots and what hangs from them, and stops at the next thing', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const cube = (id, z, parentId = null) => createSlot({ id, parentId, position: [0, 0, z], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }] });
		graph.load([createSlot({ id: 'tool' }), cube('tip', 1, 'tool'), cube('wall', 3)]);
		for (const mesh of f.scene.meshes) mesh.computeWorldMatrix(true);
		const cast = (ignore) => graph.raycastScene([0, 0, -2], [0, 0, 1], 10, ignore)?.slotId ?? null;
		assert.equal(cast(), 'tip', 'without it, the tool’s own tip is in the way');
		assert.equal(cast(['tool']), 'wall');
		assert.equal(cast(['tool', 'wall']), null);
	} finally { graph.dispose(); f.dispose(); }
});

/** The host half of the `ctx` a script on a slot of `graph` gets (scripts themselves run in a sandbox that tests cannot reach into). */
function scriptCtx(graph) {
	graph.addSlot(createSlot({ id: 'probe' }));
	return buildCodeBlockCtx('probe', graph.getLive('probe').node, graph.buildCodeBlockHost(), () => {}, { disposed: false, tracks: new Set() });
}

test('a capsule touches what comes within its radius, by each mesh’s true box, nearest first', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const mesh = (id) => [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id } }];
		const s = Math.sin(Math.PI / 8), c = Math.cos(Math.PI / 8);
		graph.load([
			createSlot({ id: 'cube', components: mesh('box') }),
			// Turned 45°: its corner reaches x = 2 - 0.707, but not out to its axis-aligned bounds.
			createSlot({ id: 'turned', position: [2, 0, 0], rotation: [0, s, 0, c], components: mesh('box') }),
			createSlot({ id: 'ball', position: [0, 0, 3], components: mesh('sphere') })
		]);
		const ctx = scriptCtx(graph);
		assert.deepEqual(ctx.world.overlap([0.52, 0, 0], [1.25, 0, 0], 0.05), ['cube', 'turned']);
		assert.deepEqual(ctx.world.overlap([0.52, 0, 0], [1.25, 0, 0], 0.05, { ignore: ['cube'] }), ['turned']);
		assert.deepEqual(ctx.world.overlap([1.25, 0, 0.6], [1.25, 0, 0.6], 0.05), [], 'outside the turned box, though inside its axis-aligned bounds');
		// Diagonally off the ball: inside its bounding cube, but 6.6 cm from its surface.
		assert.deepEqual(ctx.world.overlap([0.4, 0, 3.4], [0.4, 0, 3.4], 0.03), []);
		assert.deepEqual(ctx.world.overlap([0.4, 0, 3.4], [0.4, 0, 3.4], 0.1), ['ball']);
	} finally { graph.dispose(); f.dispose(); }
});

test('a script can move a slot under another and back, where it is in the world, and take a component off it', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const s = Math.SQRT1_2;
		graph.load([
			createSlot({ id: 'group', position: [1, 0, 0], rotation: [0, s, 0, s] }),
			createSlot({ id: 'part', position: [0, 0, 2], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'grabbable', scalable: true }] })
		]);
		const ctx = scriptCtx(graph);
		const at = () => ctx.hierarchy.getWorldPose('part').position;
		assert.equal(ctx.world.setParent('part', 'group'), true);
		assert.equal(graph.getLive('part').slot.parentId, 'group');
		assert.ok(at().every((v, i) => Math.abs(v - [0, 0, 2][i]) < 1e-6), 'it stays where it was');
		assert.equal(ctx.world.setParent('group', 'part'), false, 'never under itself');
		assert.equal(ctx.world.setParent('part', null), true);
		assert.equal(graph.getLive('part').slot.parentId, null);
		assert.ok(at().every((v, i) => Math.abs(v - [0, 0, 2][i]) < 1e-6));

		assert.equal(ctx.world.removeComponent('part', 'grabbable'), true);
		assert.ok(!graph.getLive('part').slot.components.some((c) => c.type === 'grabbable'));
		assert.equal(ctx.world.removeComponent('part', 'grabbable'), false, 'it has none left');
		assert.equal(ctx.world.removeComponent('probe', 'codeBlock'), false, 'code stays with its author');

		assert.equal(ctx.world.setWorldPose('part', { scale: [2, 0.5, 3] }), true);
		assert.deepEqual(graph.getLive('part').slot.scale, [2, 0.5, 3]);
	} finally { graph.dispose(); f.dispose(); }
});

test('scripts can list the players, read where each one is, and move them — only on the host, and only to a usable place', () => {
	const f = fixture();
	const moved = [];
	const people = [{ id: 'host-1', name: 'Host', role: 'host' }, { id: 'guest-1', name: 'Ana', role: 'guest' }];
	const pose = { head: { position: [1, 1.7, 2], rotation: [0, 0, 0, 1], forward: [0, 0, 1], up: [0, 1, 0], right: [1, 0, 0] } };
	let host = true;
	const graph = new SceneGraph(f.scene, {
		isHost: () => host,
		getPlayers: () => people,
		getPlayerPose: (id) => (id === 'guest-1' ? pose : null),
		teleportPlayer: (id, target) => { moved.push([id, target]); return id !== 'nobody'; }
	});
	try {
		const ctx = scriptCtx(graph);
		assert.deepEqual(ctx.world.getPlayers(), people);
		assert.deepEqual(ctx.world.getPlayerPose('guest-1'), pose);
		assert.equal(ctx.world.getPlayerPose('host-1'), null, 'the engine decides who is findable');
		assert.equal(ctx.world.teleportPlayer('guest-1', { position: [400, 0, 12], yaw: 1.5 }), true);
		assert.deepEqual(moved, [['guest-1', { position: [400, 0, 12], yaw: 1.5 }]]);
		assert.equal(ctx.world.teleportPlayer('nobody', { position: [0, 0, 0] }), false, 'a player who is not here');
		moved.length = 0;
		for (const bad of [null, { position: [0, NaN, 0] }, { position: [1, 2] }, { position: [1e9, 0, 0] }, { position: [0, 0, 0], yaw: Infinity }]) {
			assert.equal(ctx.world.teleportPlayer('guest-1', bad), false);
		}
		assert.deepEqual(moved, [], 'an unusable target never reaches the engine');
		host = false;
		assert.equal(ctx.world.teleportPlayer('guest-1', { position: [0, 0, 0] }), false, 'a guest cannot move people');
		assert.deepEqual(moved, []);
	} finally { graph.dispose(); f.dispose(); }
});

test('without those hooks a script sees an empty world of players and cannot move anyone', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const ctx = scriptCtx(graph);
		assert.deepEqual(ctx.world.getPlayers(), []);
		assert.equal(ctx.world.getPlayerPose('x'), null);
		assert.equal(ctx.world.teleportPlayer('x', { position: [0, 0, 0] }), false);
	} finally { graph.dispose(); f.dispose(); }
});

test('a script is told when a guest leaves, and one that throws does not stop the others', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([
			createSlot({ id: 'bad', components: [{ type: 'codeBlock', code: 'return { onPlayerLeft() { throw new Error("boom"); } };' }] }),
			createSlot({ id: 'good', components: [{ type: 'codeBlock', code: 'return { onPlayerLeft(player) { ctx.log(JSON.stringify(player)); } };' }] })
		]);
		graph.dispatchPlayerLeft({ id: 'guest-1', name: 'Ana' });
		assert.deepEqual(graph.getCodeBlockDebugLog('good').map((entry) => JSON.parse(entry.message)), [{ id: 'guest-1', name: 'Ana' }]);
		assert.match(graph.getCodeBlockDebugLog('bad')[0].message, /boom/);
	} finally { graph.dispose(); f.dispose(); }
});

test('the holder of an equipped tool is reported with the id scripts know the player by, not the connection id', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, { scriptPlayerId: (key) => (key === 'conn-7' ? 'announced-7' : key) });
	try {
		graph.setEquipQuery({ getHolderOfSlotOrAncestor: (slotId) => (slotId === 'gun' ? { playerId: 'conn-7', hand: 'right' } : null) });
		graph.load([createSlot({ id: 'gun', components: [{ type: 'codeBlock', code: 'return { tick() { ctx.log(JSON.stringify(ctx.equip.holder())); } };' }] })]);
		const holder = () => { graph.getLive('gun').runtime.tick(0); return JSON.parse(graph.getCodeBlockDebugLog('gun').at(-1).message); };
		assert.deepEqual(holder(), { playerId: 'announced-7', hand: 'right' });
		graph.setEquipQuery({ getHolderOfSlotOrAncestor: () => null });
		assert.equal(holder(), null);
	} finally { graph.dispose(); f.dispose(); }
});

test('the player body can be teleported on the desktop, keeping the way it looks when no yaw is given', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([createSlot({ id: 'floor', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' } }, { type: 'collider', shape: 'box' }] })]);
		const body = setupPlayerBody(f.scene, graph, null, f.camera, { x: 0, z: 0 });
		body.teleport({ position: [10, 0, 20], yaw: 1 });
		assert.deepEqual(f.camera.position.asArray(), [10, 1.6, 20], 'feet on the target, eyes 1.6 m above');
		assert.equal(f.camera.rotation.y, 1);
		body.teleport({ position: [3, 0, 4] });
		assert.equal(f.camera.rotation.y, 1, 'no yaw given: it keeps the way it looks');
	} finally { graph.dispose(); f.dispose(); }
});

test('a wall that appears or is switched on stops a headset player in the same frame, not up to half a second later', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		f.camera.position.set(0, 1.6, -1.5);
		f.camera.realWorldHeight = 1.6;
		const xr = { baseExperience: { state: WebXRState.IN_XR, camera: f.camera } };
		const body = setupPlayerBody(f.scene, graph, xr, f.camera, { x: 0, z: 0 }); // nothing solid yet; the set is cached
		const walk = () => { for (const mesh of f.scene.meshes) mesh.computeWorldMatrix(true); return body.constrainMove(new Vector3(0, 0, 1)).z; };
		assert.equal(walk(), 1, 'free to walk');
		graph.addSlot(createSlot({ id: 'wall', position: [0, 1, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'collider', shape: 'box' }] }));
		assert.ok(walk() < 1, 'a wall that has just appeared blocks');
		graph.setSlotEnabled('wall', false);
		assert.equal(walk(), 1, 'a door that was opened lets them through');
		graph.setSlotEnabled('wall', true);
		assert.ok(walk() < 1, 'and blocks again when closed');
	} finally { graph.dispose(); f.dispose(); }
});

test('teleporting in a headset puts the feet on the target and turns the rig to the yaw', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		f.camera.rotationQuaternion = Quaternion.Identity();
		f.camera.realWorldHeight = 1.7;
		const xr = { baseExperience: { state: WebXRState.IN_XR, camera: f.camera } };
		const body = setupPlayerBody(f.scene, graph, xr, f.camera, { x: 0, z: 0 });
		body.teleport({ position: [400, 2, -6], yaw: Math.PI / 2 });
		assert.deepEqual(f.camera.position.asArray().map((v) => Math.round(v * 1e6) / 1e6), [400, 3.7, -6]);
		const forward = f.camera.getForwardRay().direction;
		assert.ok(Math.abs(Math.atan2(forward.x, forward.z) - Math.PI / 2) < 1e-6, `facing ${Math.atan2(forward.x, forward.z)}`);
	} finally { graph.dispose(); f.dispose(); }
});

test('a spot light shines along its slot’s forward direction with the cone it was given, and a live one is always drawn', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([createSlot({ id: 'torch', name: 'torch', position: [0, 2, 0], rotation: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)], components: [{ type: 'spotLight', color: '#ffe0b0', intensity: 3, range: 15, angle: 50, exponent: 6 }] })]);
		const light = f.scene.getLightByName('torch-light');
		assert.equal(light.getClassName(), 'SpotLight');
		assert.ok(Math.abs(light.angle - (50 * Math.PI) / 180) < 1e-9 && light.exponent === 6 && light.range === 15 && light.intensity === 3);
		assert.equal(light.isEnabled(), true);
		light.parent.computeWorldMatrix(true);
		light.computeTransformedInformation();
		const dir = light.transformedDirection;
		assert.ok(dir.y < -0.99, `a quarter turn about X points +z straight down (${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})`);
		graph.setComponentField('torch', 'spotLight', 'angle', 30);
		graph.getLive('torch').runtime.sync(graph.getLive('torch').slot);
		assert.ok(Math.abs(light.angle - (30 * Math.PI) / 180) < 1e-9, 'a change of cone is followed live');
	} finally { graph.dispose(); f.dispose(); }
});

test('a baked light is made, and drawn only until the baked lighting is in; taking the slot away forgets it', async () => {
	const f = fixture();
	Object.defineProperty(f.engine, 'webGLVersion', { value: 2 });
	LightVolumeManager.textureFactory = () => ({ dispose() {} });
	const graph = new SceneGraph(f.scene, {});
	try {
		graph.load([
			createSlot({ id: 'lamp', name: 'lamp', position: [0, 2, 0], components: [{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 8, baked: true }] }),
			createSlot({ id: 'live', name: 'live', position: [3, 2, 0], components: [{ type: 'pointLight', color: '#ffffff', intensity: 1, range: 8 }] })
		]);
		const baked = f.scene.getLightByName('lamp-light'), live = f.scene.getLightByName('live-light');
		assert.equal(baked.isEnabled(), true, 'with no baked lighting it is drawn live');
		const manager = LightVolumeManager.for(f.scene);
		manager.add('v', { min: [0, 0, 0], voxel: 1, dims: [2, 2, 2], range: 1 }, new Uint8Array(2 * 2 * 2 * 6 * 4), [1, 1, 1], 1, true);
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.equal(baked.isEnabled(), false, 'with it, the volume carries its light');
		assert.equal(live.isEnabled(), true);
		graph.removeSlot('lamp');
		assert.equal(f.scene.getLightByName('lamp-light'), null);
	} finally { LightVolumeManager.peek(f.scene)?.dispose(); graph.dispose(); f.dispose(); }
});

test('a lightVolume slot loads nothing it cannot find, and goes away cleanly: no volume, the flat ambient stays as it was', () => {
	const f = fixture();
	const graph = new SceneGraph(f.scene, {});
	try {
		const slot = createSlot({ id: 'gi', name: 'gi', components: [{ type: 'lightVolume', data: { kind: 'asset', assetId: `sha256:${'a'.repeat(64)}` }, intensity: 0.5, tint: '#ff0000' }] });
		assert.doesNotThrow(() => graph.load([slot]));
		const manager = LightVolumeManager.peek(f.scene);
		assert.ok(manager, 'the scene has a manager now');
		assert.equal(manager.texture, null);
		assert.equal(manager.active, false);
		assert.doesNotThrow(() => graph.removeSlot('gi'));
	} finally { LightVolumeManager.peek(f.scene)?.dispose(); graph.dispose(); f.dispose(); }
});
