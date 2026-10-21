import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { compose, determinant3, identity, invert, multiply, transformDirection, transformNormal, transformPoint } from '../packages/engine/src/lighting/matrix.ts';

const near = (a, b, eps = 1e-9) => assert.ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps), `${Array.from(a).map((v) => v.toFixed(6))} vs ${Array.from(b).map((v) => v.toFixed(6))}`);
const norm = (q) => { const l = Math.hypot(...q); return q.map((v) => v / l); };

/** A chain of nodes, as slots are parented, and the world matrix Babylon gives the last one. */
function babylonWorld(chain) {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	try {
		let parent = null, last = null;
		for (const { position, rotation, scale } of chain) {
			const node = new TransformNode('n', scene);
			node.position = Vector3.FromArray(position);
			node.rotationQuaternion = Quaternion.FromArray(norm(rotation));
			node.scaling = Vector3.FromArray(scale);
			node.parent = parent;
			parent = last = node;
		}
		return Array.from(last.computeWorldMatrix(true).m);
	} finally { scene.dispose(); engine.dispose(); }
}
const ours = (chain) => {
	let world = null;
	for (const { position, rotation, scale } of chain) {
		const local = compose(position, rotation, scale);
		world = world ? multiply(local, world) : local;
	}
	return world;
};

const CHAINS = [
	[{ position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }],
	[{ position: [-4, 0.5, 9], rotation: [0.3, -0.5, 0.2, 0.8], scale: [2, 0.5, 3] }],
	[{ position: [10, 0, -2], rotation: [0, Math.sin(0.6), 0, Math.cos(0.6)], scale: [1, 1, 1] }, { position: [0, 1, 2], rotation: [Math.sin(0.2), 0, 0, Math.cos(0.2)], scale: [1, 1, 1] }],
	[{ position: [3, 1, -1], rotation: [0.1, 0.7, -0.3, 0.6], scale: [2, 3, 0.5] }, { position: [1, 2, 0.5], rotation: [0.5, 0.1, 0.4, 0.7], scale: [1, 2, 1] }, { position: [-2, 0, 1], rotation: [0, 0.3, 0.9, 0.1], scale: [0.5, 1.5, 2] }]
];

test('a slot’s local matrix and a chain of parents give the very matrix Babylon builds for the node', () => {
	// Babylon keeps its matrices in 32-bit floats.
	for (const chain of CHAINS) near(ours(chain), babylonWorld(chain), 1e-5);
});

test('the points, directions and normals it transforms are the ones Babylon’s matrix transforms', () => {
	for (const chain of CHAINS) {
		const m = ours(chain), b = babylonWorld(chain);
		const point = [0.3, -0.7, 1.1];
		const p = transformPoint(m, point);
		// by hand with Babylon’s own row-vector rule
		near(p, [point[0] * b[0] + point[1] * b[4] + point[2] * b[8] + b[12], point[0] * b[1] + point[1] * b[5] + point[2] * b[9] + b[13], point[0] * b[2] + point[1] * b[6] + point[2] * b[10] + b[14]], 1e-5);
		const d = transformDirection(m, [1, 0, 0]);
		near(d, [b[0], b[1], b[2]], 1e-5);
	}
});

test('the inverse takes a point back, and a transformed normal stays square to a surface under a squashing scale', () => {
	for (const chain of CHAINS) {
		const m = ours(chain), inv = invert(m);
		const p = [1.2, -3, 0.4];
		near(transformPoint(inv, transformPoint(m, p)), p, 1e-9);
		near(multiply(m, inv), identity(), 1e-9);
		// Two directions lying in a surface and the normal to it: the normal stays perpendicular to both after the transform.
		const u = [1, 0, 0], v = [0, 0, 1], n = [0, 1, 0];
		const wu = transformDirection(m, u), wv = transformDirection(m, v), wn = transformNormal(inv, n);
		assert.ok(Math.abs(wn[0] * wu[0] + wn[1] * wu[1] + wn[2] * wu[2]) < 1e-9);
		assert.ok(Math.abs(wn[0] * wv[0] + wn[1] * wv[1] + wn[2] * wv[2]) < 1e-9);
		assert.ok(Math.abs(Math.hypot(...wn) - 1) < 1e-9);
	}
});

test('a matrix that flattens space has no inverse, and a mirror is told by the sign of its determinant', () => {
	assert.equal(invert(compose([0, 0, 0], [0, 0, 0, 1], [1, 0, 1])), null);
	assert.ok(determinant3(compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])) > 0);
	assert.ok(determinant3(compose([0, 0, 0], [0, 0, 0, 1], [-1, 1, 1])) < 0);
});
