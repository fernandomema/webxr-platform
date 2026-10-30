import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelPositionOfPoint, pointOnCurvedPanel, curvedPlaneData, DASH_CURVES, DEFAULT_DASH_CURVE } from '../packages/engine/src/xr/ui/curvedPanel.ts';

const vertex = (data, i) => ({ x: data.positions[i * 3], y: data.positions[i * 3 + 1], z: data.positions[i * 3 + 2] });

test('a flat curve is the plane itself', () => {
	const data = curvedPlaneData(0, -1, 1.5, 4);
	assert.deepEqual([vertex(data, 0), vertex(data, data.positions.length / 3 - 1)].map((v) => v.z), [0, 0]);
	assert.equal(vertex(data, 0).x, -0.5);
	assert.equal(vertex(data, 9).x, 0.5);
	assert.deepEqual(data.normals.slice(0, 3), [0, 0, -1]);
});

test('a curve brings the edges toward the front, keeps the middle, and spans the same arc length', () => {
	const angle = (60 * Math.PI) / 180;
	const data = curvedPlaneData(angle, -1, 1.5, 48);
	const count = data.positions.length / 3;
	const left = vertex(data, 0);
	const mid = vertex(data, 48);
	const right = vertex(data, count - 1);
	assert.ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.z) < 1e-9);
	assert.ok(left.z < 0 && right.z < 0, 'a plane facing -z has its edges at smaller z');
	assert.ok(Math.abs(left.x + right.x) < 1e-9);
	// Radius is width / angle: 1.5 m wide at 60 degrees.
	const radius = 1.5 / angle;
	assert.ok(Math.abs(-left.z - (1.5 / angle) * (1 - Math.cos(angle / 2))) < 1e-9);
	assert.ok(left.x * 1.5 > -radius, 'x stays inside the radius');
});

test('the strip is the same triangles whichever way the plane faces, wound to face the front', () => {
	for (const frontZ of [-1, 1]) {
		const data = curvedPlaneData(1, frontZ, 1, 2);
		assert.equal(data.indices.length, 2 * 6);
		const [a, b, c] = data.indices.slice(0, 3).map((i) => vertex(data, i));
		const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
		// Babylon's own plane (front facing -z) is wound counter-clockwise in XY.
		assert.equal(Math.sign(-crossZ), frontZ, `front faces ${frontZ}`);
	}
});

test('the choices include flat and the default is one of them', () => {
	assert.ok(DASH_CURVES.some((c) => c.degrees === 0));
	assert.ok(DASH_CURVES.some((c) => c.degrees === DEFAULT_DASH_CURVE));
});

test('a point of a curved panel lies on the same surface the panel is drawn on, turned to lie along it', () => {
	const flat = pointOnCurvedPanel(0.25, 0.1, 1.5, 0.9, 0, -1);
	assert.ok(Math.abs(flat.x - 0.375) < 1e-9 && Math.abs(flat.y - 0.09) < 1e-9 && flat.z === 0 && flat.yaw === 0);
	const angle = 1;
	const data = curvedPlaneData(angle, -1, 1.5, 4);
	for (const u of [0, 0.25, 0.5, 1]) {
		const at = pointOnCurvedPanel(u - 0.5, 0, 1.5, 0.9, angle, -1);
		const vertex = data.positions.slice(u * 4 * 6, u * 4 * 6 + 3);
		assert.ok(Math.abs(at.x - vertex[0] * 1.5) < 1e-9, `x at ${u}`);
		assert.ok(Math.abs(at.z - vertex[2]) < 1e-9, `z at ${u}`);
	}
	const edge = pointOnCurvedPanel(0.5, 0, 1.5, 0.9, angle, -1);
	assert.ok(edge.yaw < 0 === pointOnCurvedPanel(-0.5, 0, 1.5, 0.9, angle, -1).yaw > 0, 'the two edges turn opposite ways');
});

test('a point over a curved panel is mapped back to where on the panel it is', () => {
	for (const angle of [0, 1, 1.4]) {
		for (const [u, v] of [[0, 0], [-0.5, 0.3], [0.5, -0.4], [0.2, 0.1]]) {
			const at = pointOnCurvedPanel(u, v, 1.5, 0.9, angle, -1);
			// z towards the side the panel faces is positive: the surface point's own z, flipped.
			const back = panelPositionOfPoint(at.x, at.y, -at.z, 1.5, 0.9, angle);
			assert.ok(Math.abs(back.u - u) < 1e-9 && Math.abs(back.v - v) < 1e-9, `${angle} ${u} ${v}`);
			// A hand held a little in front of the surface, along the line to the circle's centre, is over the same place.
			if (angle > 0) {
				const theta = u * angle;
				const hand = panelPositionOfPoint(-at.z * 0 + at.x - Math.sin(theta) * 0.1, at.y, -at.z + Math.cos(theta) * 0.1, 1.5, 0.9, angle);
				assert.ok(Math.abs(hand.u - u) < 1e-9, `hand ${angle} ${u}`);
			}
		}
	}
	assert.equal(panelPositionOfPoint(40, 0, 0, 1.5, 0.9, 1), null, 'far to the side is not over it');
});
