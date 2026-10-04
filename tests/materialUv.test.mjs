import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { worldUvs } from '../src/lib/xr/materialUv.ts';

function data(shape, build) {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const mesh = build(MeshBuilder, scene);
	const result = { positions: mesh.getVerticesData(VertexBuffer.PositionKind), normals: mesh.getVerticesData(VertexBuffer.NormalKind), uvs: mesh.getVerticesData(VertexBuffer.UVKind) };
	scene.dispose();
	engine.dispose();
	return result;
}

/** The spread of the coordinates of the vertices whose normal points along `axis` (0 x, 1 y, 2 z). */
function spread(mesh, uvs, axis) {
	const found = [];
	for (let v = 0; v < mesh.normals.length / 3; v++) if (Math.abs(mesh.normals[v * 3 + axis]) > 0.9) found.push([uvs[v * 2], uvs[v * 2 + 1]]);
	const range = (index) => Math.max(...found.map((uv) => uv[index])) - Math.min(...found.map((uv) => uv[index]));
	return [range(0), range(1)];
}

test('a wall is laid out in metres on each face, so the picture is not stretched', () => {
	const box = data('box', (builder, scene) => builder.CreateBox('b', { size: 1 }, scene));
	const uvs = worldUvs('box', box.positions, box.normals, box.uvs, [6, 2.4, 0.2], 2);
	assert.deepEqual(spread(box, uvs, 2).map((v) => Math.round(v * 1000) / 1000), [3, 1.2], 'the big face: 6 m by 2.4 m is 3 by 1.2 repeats of 2 m');
	assert.deepEqual(spread(box, uvs, 1).map((v) => Math.round(v * 1000) / 1000), [3, 0.1], 'the top: 6 m by 0.2 m');
	assert.deepEqual(spread(box, uvs, 0).map((v) => Math.round(v * 1000) / 1000), [0.1, 1.2], 'the end: 0.2 m by 2.4 m');
});

test('the same size gives the same scale on a cube and on a wall', () => {
	const box = data('box', (builder, scene) => builder.CreateBox('b', { size: 1 }, scene));
	const cube = worldUvs('box', box.positions, box.normals, box.uvs, [1, 1, 1], 1);
	const wall = worldUvs('box', box.positions, box.normals, box.uvs, [4, 1, 1], 1);
	const [cubeU] = spread(box, cube, 2);
	const [wallU] = spread(box, wall, 2);
	assert.equal(Math.round(wallU / cubeU), 4, 'four times as wide shows four times as much of the picture');
});

test('a floor and a plane follow their own size, and a ball or a column repeat along their surface', () => {
	const ground = data('ground', (builder, scene) => builder.CreateGround('g', { width: 20, height: 20 }, scene));
	const floor = worldUvs('ground', ground.positions, ground.normals, ground.uvs, [1, 1, 1], 2);
	assert.deepEqual(spread(ground, floor, 1).map(Math.round), [10, 10], '20 m of floor in repeats of 2 m');
	const sphere = data('sphere', (builder, scene) => builder.CreateSphere('s', { diameter: 1 }, scene));
	const ball = worldUvs('sphere', sphere.positions, sphere.normals, sphere.uvs, [0.5, 0.5, 0.5], 0.5);
	assert.ok(Math.abs(Math.max(...ball.filter((_, i) => i % 2 === 0)) - Math.PI) < 1e-3, 'round a half metre ball is a circumference of π d / size repeats');
	const column = data('cylinder', (builder, scene) => builder.CreateCylinder('c', { diameter: 1, height: 1 }, scene));
	const out = worldUvs('cylinder', column.positions, column.normals, column.uvs, [0.4, 2, 0.4], 1);
	assert.equal(out.length, column.uvs.length);
	assert.ok(out.every(Number.isFinite));
});
