import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { AbstractMesh, MeshBuilder, NullEngine, Quaternion, Ray, Scene, TransformNode, UniversalCamera, Vector3, WebXRState } from '@babylonjs/core';
import { createSlot } from '../src/lib/ecs/types.ts';

const coreUrl = import.meta.resolve('@babylonjs/core');
const libUrl = new URL('../src/lib/', import.meta.url);
function compile(source) {
	return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
		.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
		.replace(/'\$lib\/([^']+)'/g, (_, path) => JSON.stringify(new URL(`${path}.ts`, libUrl).href));
}
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const codeBlockUrl = moduleUrl(compile(await readFile(new URL('xr/codeBlockRuntime.ts', libUrl), 'utf8'))
	.replaceAll("'./scriptNet'", JSON.stringify(new URL('xr/scriptNet.ts', libUrl).href)));
let graphCode = compile(await readFile(new URL('xr/sceneGraph.ts', libUrl), 'utf8'))
	.replaceAll("'./slotRebuild'", JSON.stringify(new URL('xr/slotRebuild.ts', libUrl).href))
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
