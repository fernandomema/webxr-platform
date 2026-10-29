import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Quaternion, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { setupPlayerBody } from '../packages/engine/src/xr/interaction/playerBody.ts';

const DT = 1 / 60;

/** A page with a scene graph that is just a list of meshes, and a desktop camera that a test moves the way a keyboard would. */
function stage(controller, solids) {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const entries = [];
	const graph = {
		allSlots: () => entries,
		onChanged: () => () => {},
		getLive: (id) => entries.find((e) => e.slot.id === id),
		getSubtree: () => []
	};
	const add = (id, shape, components, place) => {
		const mesh = shape === 'box' ? MeshBuilder.CreateBox(id, { size: 1 }, scene) : shape === 'cylinder' || shape === 'disc' ? MeshBuilder.CreateCylinder(id, { height: 1, diameter: 1 }, scene) : MeshBuilder.CreateGround(id, { width: 20, height: 20 }, scene);
		place(mesh);
		entries.push({ slot: createSlot({ id, name: id, components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color: '#fff' }, ...components] }), node: mesh });
	};
	add('floor', 'ground', [{ type: 'collider', shape: 'box' }], (m) => { m.scaling = new Vector3(10, 1, 10); });
	solids(add);
	entries.push({ slot: createSlot({ id: 'rules', name: 'rules', components: [{ type: 'characterController', ...controller }] }), node: MeshBuilder.CreateBox('rules', { size: 0.1 }, scene) });
	const camera = new UniversalCamera('cam', new Vector3(0, 1.6, 0), scene);
	const body = setupPlayerBody(scene, graph, null, camera, { x: 0, z: 0 });
	body.respawn();
	camera.position.set(0, 1.6, 0);
	/** Runs `seconds`, moving the camera `speed` m/s along x and z first, as the keyboard does. */
	const run = (seconds, speed = [0, 0], each) => {
		for (let t = 0; t < seconds; t += DT) {
			camera.position.x += speed[0] * DT; camera.position.z += speed[1] * DT;
			body.update(DT);
			each?.(t);
		}
	};
	return { camera, body, run, feet: () => camera.position.y - 1.6, dispose: () => { scene.dispose(); engine.dispose(); } };
}
const slope = (deg) => (m) => { const a = (deg * Math.PI) / 180; m.scaling = new Vector3(40, 1, 20); m.rotationQuaternion = Quaternion.RotationAxis(new Vector3(0, 0, 1), a); m.position = new Vector3(0.5 * Math.sin(a), -0.5 * Math.cos(a), 0); };

test('with a character controller the player walks up a 40° slope, which is what a world of ramps and diamonds asks of the body', () => {
	const s = stage({ jumpSpeed: 5 }, (add) => add('ramp', 'box', [{ type: 'collider', shape: 'box' }], slope(40)));
	s.run(0.5);
	s.run(2, [1.5, 0]);
	assert.ok(s.camera.position.x > 2.5, `across: ${s.camera.position.x.toFixed(2)}`);
	assert.ok(Math.abs(s.feet() - s.camera.position.x * Math.tan((40 * Math.PI) / 180)) < 0.2, `and up: feet at ${s.feet().toFixed(2)}`);
	s.dispose();
});

test('standing on a slope the player can jump, and walk on', () => {
	const s = stage({ jumpSpeed: 5, gravity: 12 }, (add) => add('ramp', 'box', [{ type: 'collider', shape: 'box' }], slope(35)));
	s.run(1.5, [1.5, 0]);
	const y = s.feet();
	s.body.jump();
	let top = y;
	s.run(0.6, [0, 0], () => { top = Math.max(top, s.feet()); });
	assert.ok(top - y > 0.5, `it jumped ${(top - y).toFixed(2)} m`);
	const x = s.camera.position.x;
	s.run(1, [1, 0]);
	assert.ok(s.camera.position.x > x + 0.5, 'and goes on walking');
	s.dispose();
});

test('jumping against a wall again and again climbs it, and the player never ends up inside it', () => {
	const s = stage({ jumpSpeed: 5, gravity: 14, wallJump: true, coyoteTime: 0.1 }, (add) => {
		add('wall', 'box', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(2, 10, 0); m.scaling = new Vector3(1, 20, 20); });
	});
	s.run(0.3);
	s.run(1.5, [1.5, 0]);
	assert.ok(s.camera.position.x < 1.5 - 0.29 + 0.05, `held off the wall: ${s.camera.position.x.toFixed(2)}`);
	let top = 0;
	for (let i = 0; i < 8; i++) { s.body.jump(); s.run(0.4, [1.5, 0], () => { top = Math.max(top, s.feet()); }); }
	assert.ok(top > 2.5, `climbed to ${top.toFixed(2)} m`);
	s.dispose();
});

test('the colliders and a push: addImpulse throws the player and the floor under a head is the one it stands on', () => {
	const s = stage({}, (add) => add('platform', 'box', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(5, 3, 0); m.scaling = new Vector3(4, 0.5, 4); }));
	s.run(0.3);
	assert.ok(Math.abs(s.body.floorAt(5, 8, 0) - 3.25) < 0.01, 'the top of the platform, not the floor');
	assert.ok(Math.abs(s.body.floorAt(0, 8, 0)) < 0.02, 'the floor where there is no platform');
	const x = s.camera.position.x;
	s.body.addImpulse([4, 0, 0]);
	s.run(1.5);
	assert.ok(s.camera.position.x - x > 0.5, 'thrown');
	s.dispose();
});

// ------------------------------------------------------------------------------- the body ROUNDS VR asks for, on its own maps
import { buildRounds } from '../examples/rounds-vr/src/world/index.ts';
import { layoutOf } from '../examples/rounds-vr/src/world/layout.ts';
import { MAPS, ARENA } from '../examples/rounds-vr/src/world/data.ts';
import { prepareScripts } from '../examples/rounds-vr/src/world/script.ts';

await prepareScripts();
const roundsBody = buildRounds().flatMap((slot) => slot.components).find((c) => c.type === 'characterController');
const { type: _type, ...ROUNDS } = roundsBody;

/** The blocks and pillars of a map of the game, as the engine builds them from its fragment, for the body to stand on. */
const mapBlocks = (m) => (add) => {
	for (const block of layoutOf(m)) {
		add(block.id, block.kind === 'block' ? 'box' : 'cylinder', [{ type: 'collider', shape: 'box' }], (mesh) => {
			mesh.position = new Vector3(...block.position);
			mesh.rotationQuaternion = new Quaternion(...block.rotation);
			mesh.scaling = new Vector3(...block.scale);
		});
	}
};

test('on the maps of ROUNDS VR a player put on a spawn stands there, can run along the map and jump, and does not sink into the blocks', () => {
	// (Map 05's spawns are alcoves with 2.2 m of room above them: there a jump hits the ceiling, as it should.)
	for (const m of [0, 4, 9, 13]) {
		for (const side of [0, 1]) {
			const [x, y] = MAPS[m].spawns[0][side];
			// The director puts a pad under the feet of a fighter (a disc, which is a floor); some spawns are in the air above a block.
			const feet = y - 0.636 * 0.6;
			const s = stage(ROUNDS, (add) => {
				mapBlocks(m)(add);
				add('pad', 'disc', [], (mesh) => { mesh.position = new Vector3(x, feet + 0.025, 0); mesh.scaling = new Vector3(1.9, 0.01, 1.9); });
			});
			s.body.teleport({ position: [x, feet + 0.1, 0] });
			s.run(0.6);
			const rest = s.feet();
			assert.ok(rest >= feet - 0.05 && rest < feet + 0.9, `${MAPS[m].name} side ${side}: it stands on its pad or the block it is set in, and has not fallen (feet at ${rest.toFixed(2)}, pad at ${(feet + 0.03).toFixed(2)})`);
			const ground = s.feet();
			s.body.jump();
			let top = ground;
			s.run(0.5, [0, 0], () => { top = Math.max(top, s.feet()); });
			assert.ok(top - ground > (m === 4 ? 0.3 : 1.2), `${MAPS[m].name} side ${side}: it jumps from the spawn (${(top - ground).toFixed(2)} m)`);
			s.run(0.6);
			const from = s.camera.position.x;
			s.run(1.2, [side === 0 ? 3 : -3, 0]);
			assert.ok(Math.abs(s.camera.position.x - from) > 0.5, `${MAPS[m].name}: it runs (${from.toFixed(1)} → ${s.camera.position.x.toFixed(1)})`);
			assert.ok(Math.abs(s.camera.position.z) <= ARENA.depth / 2 + 1e-6, 'and stays in the lane');
			s.dispose();
		}
	}
});

test('a player of ROUNDS VR climbs a wall by jumping against it again and again, as in the game, and slides when it lets go', () => {
	const s = stage(ROUNDS, (add) => add('wall', 'box', [{ type: 'collider', shape: 'box' }], (m) => { m.position = new Vector3(2, 10, 0); m.scaling = new Vector3(1, 20, 3.5); }));
	s.run(0.3);
	s.run(1.5, [3, 0]);
	assert.ok(s.camera.position.x < 1.5 - 0.29 + 0.05, `held off the wall: ${s.camera.position.x.toFixed(2)}`);
	let top = 0;
	for (let i = 0; i < 10; i++) { s.body.jump(); s.run(0.4, [3, 0], () => { top = Math.max(top, s.feet()); }); }
	assert.ok(top > 3, `climbed to ${top.toFixed(2)} m`);
	const high = s.feet();
	s.run(1, [3, 0]);
	assert.ok(high - s.feet() < 3, `holding on it slides slowly (${(high - s.feet()).toFixed(2)} m in a second)`);
	s.dispose();
});

test('a player of ROUNDS VR walks up a slope of the game and jumps on it (the maps are full of turned blocks)', () => {
	const s = stage(ROUNDS, (add) => add('ramp', 'box', [{ type: 'collider', shape: 'box' }], slope(35)));
	s.run(1.5, [3, 0]);
	const y = s.feet();
	assert.ok(y > 0.8, `up the ramp (${y.toFixed(2)} m)`);
	s.body.jump();
	let top = y;
	s.run(0.6, [0, 0], () => { top = Math.max(top, s.feet()); });
	assert.ok(top - y > 0.5, `jumps on it (${(top - y).toFixed(2)} m)`);
	const x = s.camera.position.x;
	s.run(1, [3, 0]);
	assert.ok(s.camera.position.x > x + 1, 'and goes on walking');
	s.dispose();
});
