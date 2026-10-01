import test from 'node:test';
import assert from 'node:assert/strict';
import { stripActiveComponents } from '../src/lib/xr/thumbnail/inertTree.ts';
import { frameBounds, bustBounds, THUMBNAIL_FOV } from '../src/lib/xr/thumbnail/framing.ts';
import { cubeToEquirect, faceLookup, FACE_ORDER } from '../src/lib/xr/thumbnail/cubeToEquirect.ts';

const slot = (id, components) => ({ id, parentId: null, name: id, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });

test('a preview tree keeps what is drawn and loses everything that runs or plays', () => {
	const tree = [slot('a', [
		{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } },
		{ type: 'codeBlock', code: 'x' }, { type: 'mirror' }, { type: 'audioPlayer', source: { kind: 'url', url: '' } },
		{ type: 'htmlView' }, { type: 'particleBurst' }, { type: 'impactSound' }, { type: 'skybox' }, { type: 'textDisplay' }
	])];
	assert.deepEqual(stripActiveComponents(tree)[0].components.map((c) => c.type), ['meshRenderer', 'skybox', 'textDisplay']);
	assert.equal(tree[0].components.length, 9, 'the original is untouched');
});

test('the camera is placed so the whole bounding sphere fits the view', () => {
	const { target, radius } = frameBounds([-1, 0, -1], [1, 2, 1]);
	assert.deepEqual(target, [0, 1, 0]);
	const half = Math.hypot(2, 2, 2) / 2;
	assert.ok(radius > half / Math.sin(THUMBNAIL_FOV / 2), 'with a margin');
	assert.ok(frameBounds([0, 0, 0], [0, 0, 0]).radius > 0, 'a point still gets a usable distance');
});

test('a bust view is the top of a figure, narrowed so a T-pose does not shrink the head', () => {
	const bust = bustBounds([-0.9, 0, -0.1], [0.9, 1.8, 0.1]);
	assert.ok(bust.min[1] > 0.8 && bust.max[1] === 1.8);
	assert.ok(bust.max[0] - bust.min[0] < 1.8, 'narrower than the arm span');
	assert.ok(bust.max[2] - bust.min[2] <= 0.2 + 1e-9);
});

test('directions land on the expected cube face', () => {
	const face = (x, y, z) => FACE_ORDER[faceLookup(x, y, z).face];
	assert.equal(face(1, 0, 0), '+X');
	assert.equal(face(-1, 0.1, 0), '-X');
	assert.equal(face(0.1, 1, 0), '+Y');
	assert.equal(face(0, -1, 0.1), '-Y');
	assert.equal(face(0, 0, 1), '+Z');
	assert.equal(face(0, 0.2, -1), '-Z');
	const centre = faceLookup(0, 0, 1);
	assert.ok(Math.abs(centre.u - 0.5) < 1e-9 && Math.abs(centre.v - 0.5) < 1e-9);
});

test('the panorama rotates 180 degrees around Y: -Z in the middle, with -X on the right, up at the top and down at the bottom', () => {
	const size = 8;
	const colours = { '+X': [255, 0, 0], '-X': [0, 255, 0], '+Y': [0, 0, 255], '-Y': [255, 255, 0], '+Z': [255, 0, 255], '-Z': [0, 255, 255] };
	const faces = FACE_ORDER.map((name) => {
		const data = new Uint8Array(size * size * 4);
		for (let i = 0; i < size * size; i++) data.set([...colours[name], 255], i * 4);
		return data;
	});
	const width = 64, height = 32;
	const out = cubeToEquirect(faces, size, width, height);
	const at = (column, row) => [...out.slice((row * width + column) * 4, (row * width + column) * 4 + 3)];
	assert.deepEqual(at(width / 2, height / 2), colours['-Z'], 'centre is forward');
	assert.deepEqual(at(Math.round(width * 0.75), height / 2), colours['-X'], 'a quarter turn right is -X');
	assert.deepEqual(at(Math.round(width * 0.25), height / 2), colours['+X'], 'a quarter turn left is +X');
	assert.deepEqual(at(1, height / 2), colours['+Z'], 'the edge of the image is behind');
	assert.deepEqual(at(width / 2, 0), colours['+Y'], 'top row is up');
	assert.deepEqual(at(width / 2, height - 1), colours['-Y'], 'bottom row is down');
	assert.throws(() => cubeToEquirect([], size, width, height));
});

import { flipRows } from '../src/lib/xr/thumbnail/cubeToEquirect.ts';

test('flipRows turns a texture read back bottom-first into top-first, leaving pixels intact', () => {
	const size = 3;
	const face = new Uint8Array(size * size * 4);
	for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) face.set([row * 10 + column, 0, 0, 255], (row * size + column) * 4);
	const flipped = flipRows(face, size);
	assert.deepEqual([...flipped.slice(0, 4)], [20, 0, 0, 255], 'the old last row is now first');
	assert.deepEqual([...flipped.slice(8, 12)], [22, 0, 0, 255], 'columns keep their order');
	assert.deepEqual(flipRows(flipped, size), face, 'flipping twice restores it');
});

test('a mirror is drawn as a pale panel when it cannot reflect, unless it already has a colour', () => {
	const mirror = (color) => slot('m', [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, ...(color ? { color } : {}) }, { type: 'mirror' }]);
	const plain = stripActiveComponents([mirror()])[0].components;
	assert.equal(plain.length, 1);
	assert.equal(plain[0].color, '#b6c4d6');
	assert.equal(stripActiveComponents([mirror('#ff0000')])[0].components[0].color, '#ff0000');
});
