import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBuilder, NullEngine, Quaternion, Scene, Vector3, VertexData } from '@babylonjs/core';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { SceneColliders } from '../packages/engine/src/xr/sceneColliders.ts';

const near = (a, b, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

function stage() {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const entries = [];
	let listener = null;
	const source = { allSlots: () => entries, onChanged: (fn) => { listener = fn; return () => { listener = null; }; } };
	const add = (id, shape, components, place) => {
		const mesh = shape === 'box' ? MeshBuilder.CreateBox(id, { size: 1 }, scene) : shape === 'sphere' ? MeshBuilder.CreateSphere(id, { diameter: 1 }, scene) : shape === 'cylinder' ? MeshBuilder.CreateCylinder(id, { height: 1, diameter: 1 }, scene) : MeshBuilder.CreateGround(id, { width: 20, height: 20 }, scene);
		place(mesh);
		const slot = createSlot({ id, name: id, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color: '#fff' }, ...components] });
		entries.push({ slot, node: mesh });
		listener?.([id]);
		return mesh;
	};
	return { scene, engine, entries, source, add, dispose: () => { scene.dispose(); engine.dispose(); } };
}

test('a box slot is a box where its node is, scaled and turned', () => {
	const s = stage();
	s.add('b', 'box', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(3, 1, 0); m.scaling = new Vector3(4, 2, 6); m.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 2); });
	const colliders = new SceneColliders(s.source);
	const world = colliders.sync();
	const shape = world.get('b').shape;
	assert.equal(shape.kind, 'box');
	assert.deepEqual(shape.center.map((n) => Math.round(n * 1e4) / 1e4), [3, 1, 0]);
	// A quarter turn about z: the 4 along local x is now along y.
	near(shape.half[0], 2); near(shape.half[1], 1); near(shape.half[2], 3);
	near(Math.abs(shape.axes[0][1]), 1);
	const hit = world.raycast([0, 1, 0], [1, 0, 0], 100);
	near(hit.t, 3 - 1, 1e-3);
	s.dispose();
});

test('a ground plane is a thin box a body can stand on, a sphere a sphere, a cylinder a cylinder', () => {
	const s = stage();
	s.add('floor', 'ground', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(0, 0, 0); });
	s.add('ball', 'sphere', [{ type: 'collider', shape: 'sphere' }], (m) => { m.position = new Vector3(5, 3, 0); m.scaling = new Vector3(2, 2, 2); });
	s.add('post', 'cylinder', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(-5, 2, 0); m.scaling = new Vector3(1, 4, 1); });
	const world = new SceneColliders(s.source).sync();
	near(world.raycast([0, 5, 0], [0, -1, 0], 100).t, 5, 0.02);
	assert.equal(world.get('ball').shape.kind, 'sphere');
	near(world.get('ball').shape.radius, 1);
	assert.equal(world.get('post').shape.kind, 'cylinder');
	near(world.get('post').shape.halfLength, 2);
	near(world.get('post').shape.radius, 0.5);
	s.dispose();
});

test('a slot that moves is found where it went, a slot switched off is gone, and what is not a collider is not there', () => {
	const s = stage();
	const mesh = s.add('b', 'box', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(5, 0, 0); });
	s.add('decor', 'box', [], (m) => { m.position = new Vector3(2, 0, 0); });
	s.add('prop', 'box', [{ type: 'collider', shape: 'box' }, { type: 'grabbable', scalable: false }], (m) => { m.position = new Vector3(1, 0, 0); });
	const colliders = new SceneColliders(s.source);
	assert.equal(colliders.sync().ids().join(), 'b', 'only the collider that is not a thing to pick up');
	near(colliders.world.raycast([0, 0, 0], [1, 0, 0], 100).t, 4.5, 1e-3);
	mesh.position = new Vector3(9, 0, 0);
	near(colliders.sync().raycast([0, 0, 0], [1, 0, 0], 100).t, 8.5, 1e-3);
	mesh.setEnabled(false);
	assert.equal(colliders.sync().size, 0);
	mesh.setEnabled(true);
	assert.equal(colliders.sync().size, 1);
	s.entries.pop(); s.entries.pop();
	s.entries.shift();
	colliders.invalidate();
	assert.equal(colliders.sync().size, 0, 'a removed slot is taken out');
	s.dispose();
});

test('a collider with its own box is that box, placed and sized in the object\'s space and scaled with it', () => {
	const s = stage();
	// A cylinder drawn 1 across, scaled 2 on every side; the box is 1 x 3 x 1 and sits 0.5 to the side of its middle.
	s.add('post', 'cylinder', [{ type: 'collider', shape: 'box', center: [0.5, 0, 0], size: [1, 3, 1] }], (m) => { m.position = new Vector3(10, 0, 0); m.scaling = new Vector3(2, 2, 2); });
	const shape = new SceneColliders(s.source).sync().get('post').shape;
	assert.equal(shape.kind, 'box');
	assert.deepEqual(shape.center.map((n) => Math.round(n * 1e4) / 1e4), [11, 0, 0]);
	near(shape.half[0], 1); near(shape.half[1], 3); near(shape.half[2], 1);
	s.dispose();
});

test('a model collider of shape mesh is solid as its triangles: a room is hollow, not a box round the player', () => {
	const s = stage();
	// A room 10 x 4 x 10 whose faces are triangles, made as a child of the model's root and scaled by it.
	const room = new Mesh('room-geometry', s.scene);
	const [x0, x1, y0, y1, z0, z1] = [-0.5, 0.5, 0, 0.4, -0.5, 0.5];
	const quad = (a, b, c, d) => [a, b, c, a, c, d];
	const corners = [
		...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), ...quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
		...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
		...quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
	];
	const data = new VertexData();
	data.positions = corners.flat();
	data.indices = corners.map((_, i) => i);
	data.applyToMesh(room);
	const root = MeshBuilder.CreateBox('room-proxy', { size: 1 }, s.scene);
	root.scaling = new Vector3(10, 10, 10);
	room.parent = root;
	const slot = createSlot({ id: 'room', name: 'room', components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: 'sha256:x' } }, { type: 'collider', shape: 'mesh' }] });
	s.entries.push({ slot, node: root, model: { instance: { root: { getChildMeshes: () => [room] } } } });
	const world = new SceneColliders(s.source).sync();
	assert.equal(world.get('room').shape.kind, 'mesh');
	const down = world.raycast([0, 2, 0], [0, -1, 0], 50);
	near(down.t, 2, 1e-3);
	near(world.raycast([0, 1, 0], [1, 0, 0], 50).t, 5, 1e-3);
	assert.equal(world.overlapSphere([0, 2, 0], 0.5).length, 0, 'nothing is solid in the middle of the room');
	s.dispose();
});
