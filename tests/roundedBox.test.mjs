import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundedBox, roundedBoxForScale, BOX_EDGES } from '../packages/engine/src/xr/roundedBox.ts';

const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

test('every triangle turns against its normal, as Babylon draws a box', () => {
	for (const edges of [undefined, [], ['top-front'], ['front-left', 'front-right', 'back-left', 'back-right'], ['top-front', 'top-back', 'bottom-front', 'bottom-back']]) {
		const d = roundedBox([1, 2, 3], 0.3, edges);
		for (let t = 0; t < d.indices.length; t += 3) {
			const [a, b, c] = [0, 1, 2].map((k) => d.indices[t + k] * 3);
			const e1 = [0, 1, 2].map((i) => d.positions[b + i] - d.positions[a + i]);
			const e2 = [0, 1, 2].map((i) => d.positions[c + i] - d.positions[a + i]);
			const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
			const dot = [0, 1, 2].reduce((s, i) => s + cross[i] * (d.normals[a + i] + d.normals[b + i] + d.normals[c + i]), 0);
			if (Math.hypot(...cross) > 1e-9) assert.ok(dot < 0, `triangle ${t / 3} faces the wrong way`);
		}
	}
});

test('without a radius it is the plain box', () => {
	const d = roundedBox([2, 1, 1], 0);
	for (let v = 0; v < d.positions.length; v += 3) {
		assert.ok(near(Math.abs(d.positions[v]), 1) || near(Math.abs(d.positions[v + 1]), 0.5) || near(Math.abs(d.positions[v + 2]), 0.5));
		assert.ok(Math.abs(d.positions[v]) <= 1 + 1e-6 && Math.abs(d.positions[v + 1]) <= 0.5 + 1e-6);
	}
});

test('a rounded corner is pulled in by the radius', () => {
	const d = roundedBox([1, 1, 1], 0.2);
	let max = 0;
	for (let v = 0; v < d.positions.length; v += 3) max = Math.max(max, Math.hypot(d.positions[v], d.positions[v + 1], d.positions[v + 2]));
	// The farthest point is the corner sphere: centre at 0.3 on each axis plus the radius.
	assert.ok(near(max, Math.hypot(0.3, 0.3, 0.3) + 0.2));
	for (let v = 0; v < d.normals.length; v += 3) assert.ok(near(Math.hypot(d.normals[v], d.normals[v + 1], d.normals[v + 2]), 1, 1e-4));
});

test('only the chosen edges are rounded', () => {
	const d = roundedBox([1, 1, 1], 0.3, ['top-front']);
	const has = (x, y, z) => { for (let v = 0; v < d.positions.length; v += 3) if (near(d.positions[v], x) && near(d.positions[v + 1], y) && near(d.positions[v + 2], z)) return true; return false; };
	assert.ok(!has(0.2, 0.5, -0.5), 'the top front edge is cut');
	assert.ok(has(0.2, 0.5, 0.5) && has(0.5, 0.5, 0.2) && has(0.5, 0.2, -0.5) && has(0.2, -0.5, -0.5), 'the others stay sharp');
	assert.equal(BOX_EDGES.length, 12);
});

test('the vertex count does not depend on the radius or the edges', () => {
	assert.equal(roundedBox([1, 1, 1], 0).positions.length, roundedBox([4, 1, 2], 0.4, ['top-left']).positions.length);
});

test('scaled, the rounds are the same size in metres on every side', () => {
	const d = roundedBoxForScale([4, 1, 1], 0.2);
	// Back in the world (times the scale) the box is 4 x 1 x 1 and the flat part of the long face ends 0.2 m from its edge.
	let top = -Infinity;
	for (let v = 0; v < d.positions.length; v += 3) top = Math.max(top, d.positions[v + 1] * 1);
	assert.ok(near(top, 0.5));
	let flatX = 0;
	for (let v = 0; v < d.positions.length; v += 3) if (near(d.positions[v + 1], 0.5)) flatX = Math.max(flatX, Math.abs(d.positions[v] * 4));
	assert.ok(near(flatX, 2 - 0.2, 1e-4));
});
