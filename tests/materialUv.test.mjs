import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { worldUvs } from '../packages/engine/src/xr/materialUv.ts';

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

test('the picture starts on a whole tile at the corner and, fitted, ends on one too', () => {
	const box = data('box', (builder, scene) => builder.CreateBox('b', { size: 1 }, scene));
	const loose = worldUvs('box', box.positions, box.normals, box.uvs, [3.5, 1, 1], 1);
	const fitted = worldUvs('box', box.positions, box.normals, box.uvs, [3.5, 1, 1], 1, true);
	for (const uvs of [loose, fitted]) for (const axis of [1, 2]) assert.equal(Math.min(...uvs.filter((_, i) => i % 2 === 0 && Math.abs(box.normals[(i / 2) * 3 + axis]) > 0.9)), 0, 'starts at the corner');
	assert.deepEqual(spread(box, loose, 2), [3.5, 1], 'unfitted, the last tile is cut');
	assert.deepEqual(spread(box, fitted, 2).map(Math.round), [4, 1], 'fitted, 3.5 m is 4 whole tiles');
	assert.equal(spread(box, fitted, 1)[0], 4, 'the top has the same count along the shared edge');
	const small = worldUvs('box', box.positions, box.normals, box.uvs, [0.3, 0.3, 0.3], 1, true);
	assert.equal(Math.round(spread(box, small, 2)[0] * 100) / 100, 0.3, 'an object smaller than a tile keeps its real scale');
});

test('wrapped, a box side continues the top across their shared edge', () => {
	const box = data('box', (builder, scene) => builder.CreateBox('b', { size: 1 }, scene));
	const uvs = worldUvs('box', box.positions, box.normals, box.uvs, [4, 1, 2], 1, true, true);
	const at = (axis, sign, pick) => {
		const found = [];
		for (let v = 0; v < box.normals.length / 3; v++) if (box.normals[v * 3 + axis] * sign > 0.9 && pick(box.positions, v)) found.push([uvs[v * 2], uvs[v * 2 + 1]]);
		return found;
	};
	const topFront = at(1, 1, (p, v) => p[v * 3 + 2] > 0).map((uv) => uv.join());
	const sideTop = at(2, 1, (p, v) => p[v * 3 + 1] > 0).map((uv) => uv.join());
	assert.deepEqual(sideTop.sort(), topFront.sort(), 'the top edge has the same coordinates seen from both faces');
	const sideBottom = at(2, 1, (p, v) => p[v * 3 + 1] < 0);
	assert.ok(sideBottom.every((uv) => uv[1] === 3), 'a metre down the side is a metre further on');
});

test('wrapped round the sides, the vertical edges are continuous and the strip closes on itself', () => {
	const box = data('box', (builder, scene) => builder.CreateBox('b', { size: 1 }, scene));
	const uvs = worldUvs('box', box.positions, box.normals, box.uvs, [4, 1, 2], 1, true, 'around');
	const edge = (axis, sign, x, z) => {
		const found = [];
		for (let v = 0; v < box.normals.length / 3; v++) {
			if (box.normals[v * 3 + axis] * sign > 0.9 && Math.sign(box.positions[v * 3]) === x && Math.sign(box.positions[v * 3 + 2]) === z && box.positions[v * 3 + 1] > 0) found.push(uvs[v * 2] + ',' + uvs[v * 2 + 1]);
		}
		return found[0];
	};
	assert.equal(edge(2, 1, 1, 1), edge(0, 1, 1, 1), 'front and right meet at the same coordinates');
	assert.equal(edge(0, 1, 1, -1), edge(2, -1, 1, -1), 'right and back');
	assert.equal(edge(2, -1, -1, -1), edge(0, -1, -1, -1), 'back and left');
	const left = [];
	for (let v = 0; v < box.normals.length / 3; v++) if (box.normals[v * 3] < -0.9) left.push(uvs[v * 2]);
	assert.equal(Math.max(...left), 12, 'the left side ends at the whole perimeter (2 × (4 + 2))');
});

test('triplanar: a surface facing an axis uses only that projection, a diagonal one shares them out', async () => {
	const { triplanarWeights, TRIPLANAR_DEFINITIONS, TRIPLANAR_NORMAL_CODE } = await import('../packages/engine/src/xr/materialTriplanar.ts');
	assert.deepEqual(triplanarWeights([0, 1, 0]), [0, 1, 0]);
	assert.deepEqual(triplanarWeights([0, -1, 0]), [0, 1, 0], 'up or down, the same projection');
	const [x, y, z] = triplanarWeights([0.577, 0.577, 0.577]);
	assert.ok(Math.abs(x - y) < 1e-9 && Math.abs(y - z) < 1e-9 && Math.abs(x + y + z - 1) < 1e-9);
	const sharp = triplanarWeights([0.8, 0.6, 0], 8)[0];
	assert.ok(sharp > triplanarWeights([0.8, 0.6, 0], 2)[0], 'a higher sharpness keeps the projections further apart');
	assert.ok(TRIPLANAR_DEFINITIONS.includes('#define TEXRD(s, uv) _triRead(s)') && TRIPLANAR_NORMAL_CODE.includes('normalW ='));
});

test('the triplanar plugin attaches to a PBR material and turns on and off', async () => {
	const { PBRMaterial } = await import('@babylonjs/core');
	const { TriplanarPlugin } = await import('../packages/engine/src/xr/triplanarPlugin.ts');
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const material = new PBRMaterial('m', scene);
	const plugin = new TriplanarPlugin(material);
	assert.equal(material.pluginManager.getPlugin('Triplanar'), plugin);
	const defines = {};
	plugin.prepareDefines(defines);
	assert.deepEqual(defines, { TRIPLANAR: false, TRIPLANAR_NORMAL: false });
	plugin.enabled = true;
	plugin.prepareDefines(defines);
	assert.equal(defines.TRIPLANAR, true);
	assert.equal(plugin.getCustomCode('vertex'), null);
	assert.deepEqual(Object.keys(plugin.getCustomCode('fragment')), ['CUSTOM_FRAGMENT_DEFINITIONS', 'CUSTOM_FRAGMENT_BEFORE_LIGHTS']);
	scene.dispose();
	engine.dispose();
});

test('triplanar fitted: every side of an object holds a whole number of repeats', async () => {
	const { repeatsPerMetre } = await import('../packages/engine/src/xr/materialTriplanar.ts');
	const [x, y, z] = repeatsPerMetre([3.5, 1.2, 0.3], 1, true);
	assert.equal(Math.round(x * 3.5 * 1e6) / 1e6, 4, '3.5 m is 4 repeats');
	assert.equal(Math.round(y * 1.2 * 1e6) / 1e6, 1, '1.2 m is 1 repeat');
	assert.ok(Math.abs(z - 1) < 1e-9, 'shorter than one repeat keeps its real size');
	assert.ok(Math.abs(repeatsPerMetre([3.5, 1, 1], 1, false)[0] - 1) < 1e-9, 'unfitted, one repeat is always size metres');
});

test('triplanar fixed to the object: the edges cross the middle of the cells, and every edge shows the same stretch of picture', async () => {
	const { edgeOffset, repeatsPerMetre } = await import('../packages/engine/src/xr/materialTriplanar.ts');
	assert.equal(edgeOffset(2), 0.25, 'a 2 by 2 checker starts a quarter of a repeat in, the middle of its first cell');
	assert.equal(edgeOffset(1), 0.5);
	assert.equal(edgeOffset(0), 0);
	const extent = [4.0888, 1, 3.3995];
	const counts = repeatsPerMetre(extent, 1, true).map((k, i) => k * extent[i]);
	for (const count of counts) assert.ok(Math.abs(count - Math.round(count)) < 1e-9, 'whole repeats on every side, so both ends of each side meet the same stretch of picture');
	assert.ok(Math.abs(repeatsPerMetre([1, 1, 0.3], 1, true)[2] - 1) < 1e-9, 'a side shorter than half a repeat keeps its real size');
	assert.ok(Math.abs(repeatsPerMetre([1, 1, 0.6], 1, true)[2] * 0.6 - 1) < 1e-9, 'a side of at least half a repeat is fitted to one');
});

test('the cells of a picture are found from where it changes, grain and all', async () => {
	const { detectCells, cornerOffset } = await import('../packages/engine/src/xr/textureCells.ts');
	const size = 128;
	const make = (cells, shift, grain) => {
		const gray = new Float64Array(size * size);
		let seed = 7;
		const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
			const cx = Math.floor((((x / size - shift) % 1) + 1) % 1 * cells);
			const cy = Math.floor((((y / size - shift) % 1) + 1) % 1 * cells);
			gray[y * size + x] = ((cx + cy) & 1 ? 190 : 90) + (random() - 0.5) * grain;
		}
		return gray;
	};
	const two = detectCells(make(2, 0, 30), size, size);
	assert.equal(two.cells, 2);
	assert.ok(Math.abs(two.phase) < 0.02, 'borders at 0 and a half');
	assert.ok(Math.abs(cornerOffset(two) - 0.25) < 0.02, 'a corner goes in the middle of the first cell');
	const shifted = detectCells(make(2, 0.125, 30), size, size);
	assert.equal(shifted.cells, 2);
	assert.ok(Math.abs(cornerOffset(shifted) - 0.375) < 0.02, 'the picture starts an eighth in: the middle of a cell moves with it');
	assert.equal(detectCells(make(4, 0, 30), size, size).cells, 4);
	assert.equal(detectCells(make(1, 0, 0), size, size)?.cells ?? 1, 1);
	assert.equal(detectCells(make(2, 0, 0).map(() => 128), size, size), null, 'a flat picture has none');
	assert.equal(cornerOffset(null), 0);
});

test('the cells are found each way on their own: a picture whose rows start lower than its columns', async () => {
	const { detectGrid, cornerOffset } = await import('../packages/engine/src/xr/textureCells.ts');
	const size = 128;
	const gray = new Float64Array(size * size);
	// Columns change at 0, 32, 64, 96; rows (from the top) at 23, 55, 87, 119.
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) gray[y * size + x] = ((Math.floor(x / 32) + Math.floor(((y - 23 + size) % size) / 32)) & 1) ? 190 : 90;
	const grid = detectGrid(gray, size, size);
	assert.equal(grid.u.cells, 4);
	assert.equal(grid.v.cells, 4);
	assert.ok(Math.abs(cornerOffset(grid.u) - 0.125) < 0.01, 'across: the middle of the first cell');
	// Shown with the top row at v = 1, the row borders are at v = 1 - 23/128 and every quarter from there: 0.0703 + n / 4.
	assert.ok(Math.abs(cornerOffset(grid.v) - (0.0703 + 0.125)) < 0.01, 'up: the middle of the first cell counted from the bottom');
});
