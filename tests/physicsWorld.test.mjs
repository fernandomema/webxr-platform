import { test } from 'node:test';
import assert from 'node:assert/strict';
import { box, cylinder, sphere, nearest, rayShape } from '../packages/engine/src/physics/shapes.ts';
import { CollisionWorld } from '../packages/engine/src/physics/world.ts';
import { buildTriMesh } from '../packages/engine/src/physics/triMesh.ts';
import { CharacterBody, DEFAULT_CHARACTER } from '../packages/engine/src/physics/character.ts';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
const nearV = (a, b, e = 1e-6) => a.forEach((v, i) => near(v, b[i], e));
const turn = (deg) => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];

test('a point is as far from a box as its nearest face, edge or corner, and inside it is negative', () => {
	const b = box([0, 0, 0], [1, 1, 1]);
	assert.equal(nearest(b, [3, 0, 0]).distance, 2);
	nearV(nearest(b, [3, 0, 0]).normal, [1, 0, 0]);
	near(nearest(b, [2, 2, 0]).distance, Math.SQRT2);
	near(nearest(b, [2, 2, 2]).distance, Math.sqrt(3));
	const inside = nearest(b, [0.9, 0, 0]);
	near(inside.distance, -0.1);
	nearV(inside.normal, [1, 0, 0]);
	nearV(inside.point, [1, 0, 0]);
});

test('a turned box is turned: the nearest point of a diamond is on its slope', () => {
	const diamond = box([0, 0, 0], [1, 1, 5], turn(45));
	const n = nearest(diamond, [0, 2, 0]);
	near(n.distance, 2 - Math.SQRT2);
	nearV(n.point, [0, Math.SQRT2, 0], 1e-9);
	const side = nearest(diamond, [1.5, 1.5, 0]);
	near(side.distance, 3 / Math.SQRT2 - 1, 1e-9);
	nearV(side.normal, [Math.SQRT1_2, Math.SQRT1_2, 0], 1e-9);
});

test('spheres and cylinders answer the same questions', () => {
	near(nearest(sphere([0, 0, 0], 2), [5, 0, 0]).distance, 3);
	const c = cylinder([0, 0, 0], 1, 2); // axis along y, 4 tall
	near(nearest(c, [3, 0, 0]).distance, 2);
	near(nearest(c, [0, 5, 0]).distance, 3);
	near(nearest(c, [2, 3, 0]).distance, Math.SQRT2);
	assert.ok(nearest(c, [0.2, 0.2, 0]).distance < 0);
	nearV(nearest(c, [0.9, 0, 0]).normal, [1, 0, 0]);
	nearV(nearest(c, [0, 1.9, 0]).normal, [0, 1, 0]);
});

test('a ray enters a box, a sphere and a cylinder where it should, and a ray that starts inside hits at once', () => {
	const hit = rayShape(box([5, 0, 0], [1, 1, 1]), [0, 0, 0], [1, 0, 0], 100);
	near(hit.t, 4);
	nearV(hit.normal, [-1, 0, 0]);
	assert.equal(rayShape(box([5, 0, 0], [1, 1, 1]), [0, 0, 0], [1, 0, 0], 3), null, 'too short');
	assert.equal(rayShape(box([5, 5, 0], [1, 1, 1]), [0, 0, 0], [1, 0, 0], 100), null, 'it misses');
	near(rayShape(sphere([5, 0, 0], 1), [0, 0, 0], [1, 0, 0], 100).t, 4);
	near(rayShape(cylinder([5, 0, 0], 1, 2), [0, 0, 0], [1, 0, 0], 100).t, 4);
	near(rayShape(cylinder([0, 5, 0], 1, 2), [0, 0, 0], [0, 1, 0], 100).t, 3, 1e-9);
	assert.equal(rayShape(box([0, 0, 0], [1, 1, 1]), [0, 0, 0], [1, 0, 0], 10).t, 0);
	near(rayShape(box([0, 0, 0], [1, 1, 1], turn(45)), [-5, 0, 0], [1, 0, 0], 100).t, 5 - Math.SQRT2, 1e-9);
});

test('the world answers for the first thing a ray meets, and passes through what it is told to ignore', () => {
	const world = new CollisionWorld();
	world.set('near', box([5, 0, 0], [1, 1, 1]));
	world.set('far', box([10, 0, 0], [1, 1, 1]));
	const hit = world.raycast([0, 0, 0], [2, 0, 0], 100);
	assert.equal(hit.id, 'near');
	near(hit.t, 4);
	assert.equal(world.raycast([0, 0, 0], [1, 0, 0], 100, { ignore: (id) => id === 'near' }).id, 'far');
	world.remove('near');
	assert.equal(world.raycast([0, 0, 0], [1, 0, 0], 100).id, 'far');
	world.set('far', box([10, 50, 0], [1, 1, 1]));
	assert.equal(world.raycast([0, 0, 0], [1, 0, 0], 100), null, 'a solid that moved is not where it was');
});

test('a sphere cast stops a radius short of a face, slides along one, and reports a sphere already inside', () => {
	const world = new CollisionWorld();
	world.set('wall', box([10, 0, 0], [1, 5, 5]));
	const hit = world.sphereCast([0, 0, 0], 0.5, [1, 0, 0], 100);
	near(hit.t, 8.5, 1e-3);
	nearV(hit.normal, [-1, 0, 0], 1e-3);
	assert.equal(world.sphereCast([0, 0, 0], 0.5, [0, 1, 0], 100), null, 'along the face, the wall is 9 away');
	world.set('floor', box([0, -1, 0], [50, 0.5, 50]));
	assert.equal(world.sphereCast([0, 0.52, 0], 0.5, [1, 0, 0], 8), null, 'a sphere resting on a floor rolls along it freely');
	assert.equal(world.sphereCast([9.6, 0, 0], 0.5, [1, 0, 0], 1).t, 0, 'inside, moving deeper');
	assert.equal(world.sphereCast([9.6, 0, 0], 0.5, [-1, 0, 0], 1), null, 'inside, moving out: nothing to stop it');
	const corner = world.sphereCast([0, 5.2, 0], 0.5, [1, -0.1, 0], 100);
	assert.ok(corner && corner.t > 0, 'it finds the top corner of the wall');
});

test('what a sphere is inside of, deepest first, with the way out', () => {
	const world = new CollisionWorld();
	world.set('floor', box([0, -0.5, 0], [10, 0.5, 10]));
	world.set('wall', box([1, 1, 0], [0.5, 2, 5]));
	const hits = world.overlapSphere([0.2, 0.3, 0], 0.5);
	const floor = hits.find((h) => h.id === 'floor');
	near(floor.depth, 0.2);
	nearV(floor.normal, [0, 1, 0]);
	const wall = hits.find((h) => h.id === 'wall');
	nearV(wall.normal, [-1, 0, 0]);
	near(wall.depth, 0.2);
	assert.deepEqual(world.overlapSphere([0, 5, 0], 0.5), []);
	assert.equal(world.closest([0, 3, 0]).id, 'wall');
});

// A hollow room, 10 m wide and 4 m tall, as triangles: a floor, a ceiling and four walls, each two triangles.
function roomMesh() {
	const [x0, x1, y0, y1, z0, z1] = [-5, 5, 0, 4, -5, 5];
	const quad = (a, b, c, d) => [a, b, c, a, c, d];
	const corners = quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
		.concat(quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]))
		.concat(quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]))
		.concat(quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]))
		.concat(quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]))
		.concat(quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]));
	return buildTriMesh(Float32Array.from(corners.flat()), corners.map((_, i) => i));
}

test('a room made of triangles is solid at its walls and floor, and hollow inside', () => {
	const world = new CollisionWorld();
	world.set('room', roomMesh());
	const down = world.raycast([0, 2, 0], [0, -1, 0], 50);
	assert.ok(down && Math.abs(down.t - 2) < 1e-6 && down.normal[1] > 0.99, 'a ray from inside meets the floor, facing it');
	const across = world.raycast([0, 1, 0], [1, 0, 0], 50);
	assert.ok(across && Math.abs(across.t - 5) < 1e-6 && across.normal[0] < -0.99, 'and the wall');
	assert.equal(world.raycast([0, 1, 0], [1, 0, 0], 3), null, 'but not a wall further than it reaches');
	assert.equal(world.raycast([20, 1, 0], [0, 1, 0], 50), null, 'a ray outside the room meets nothing');
	assert.equal(world.overlapSphere([0, 2, 0], 0.5).length, 0, 'the middle of the room is free');
	const near = world.overlapSphere([4.8, 2, 0], 0.5);
	assert.equal(near.length, 1);
	assert.ok(near[0].normal[0] < -0.99 && Math.abs(near[0].depth - 0.3) < 1e-6, 'a sphere in the wall is pushed back into the room');
	const cast = world.sphereCast([0, 2, 0], 0.3, [1, 0, 0], 20);
	assert.ok(cast && Math.abs(cast.t - 4.7) < 0.01, `a sphere stops a radius short of the wall (${cast?.t})`);
});

test('a body stands in a room made of triangles, walks to its wall and stops, where a box round the room would have swallowed it', () => {
	const world = new CollisionWorld();
	world.set('room', roomMesh());
	const body = new CharacterBody(DEFAULT_CHARACTER, world);
	body.teleport([0, 0.5, 0]);
	for (let i = 0; i < 120; i++) body.step([0, 0, 0], 0.016);
	assert.ok(Math.abs(body.position[1]) < 0.02 && body.grounded, `it landed on the floor (${body.position[1].toFixed(3)})`);
	for (let i = 0; i < 200; i++) body.step([0.1, 0, 0], 0.016);
	assert.ok(body.position[0] < 4.75 && body.position[0] > 4.5, `it stopped at the wall (${body.position[0].toFixed(3)})`);
});
