import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { panelUvAt, setPanelSurfaceInfo } from '../packages/engine/src/xr/ui/panelSurface.ts';
import { registerGridDropTarget, gridDropTargets } from '../packages/engine/src/xr/ui/gridDrop.ts';

function stage() {
	const scene = new Scene(new NullEngine());
	return { scene, dispose: () => scene.dispose() };
}

test('a point in front of a flat panel is over the place on its picture that is straight behind it', () => {
	const { scene, dispose } = stage();
	const panel = MeshBuilder.CreatePlane('p', { width: 2, height: 1 }, scene);
	panel.position = new Vector3(5, 3, 1);
	// Its picture faces -z: a hand at -z of it, in front of its right half and its upper part.
	const over = panelUvAt(panel, new Vector3(5.5, 3.25, 0.9));
	assert.ok(Math.abs(over.u - 0.75) < 1e-6 && Math.abs(over.v - 0.75) < 1e-6, JSON.stringify(over));
	assert.equal(panelUvAt(panel, new Vector3(5, 3, -4)), null, 'too far in front is not over it');
	dispose();
});

test('a scaled unit panel, bent like the menu, is read along its arc', () => {
	const { scene, dispose } = stage();
	const menu = MeshBuilder.CreatePlane('menu', { size: 1 }, scene);
	menu.scaling = new Vector3(1.5, 0.8, 1);
	setPanelSurfaceInfo(menu, { unit: true, curve: () => 1 });
	assert.deepEqual(Object.keys(panelUvAt(menu, new Vector3(0, 0, -0.05))), ['u', 'v']);
	const middle = panelUvAt(menu, new Vector3(0, 0.2, -0.05));
	assert.ok(Math.abs(middle.u - 0.5) < 1e-9 && Math.abs(middle.v - 0.75) < 1e-9);
	// Bent, the edge of the panel is nearer the viewer: a point at the flat edge's x but out at the arc's z is over the edge, not beyond it.
	const radius = 1.5 / 1;
	const edge = panelUvAt(menu, new Vector3(radius * Math.sin(0.5), 0, -radius * (1 - Math.cos(0.5))));
	assert.ok(Math.abs(edge.u - 1) < 1e-6, `${edge.u}`);
	dispose();
});

test('grids that take pieces of UI register and let go again', () => {
	const target = { isOpen: () => true, pointAt: () => null, previewDrop() {}, pinUi: () => 'not-ui' };
	const stop = registerGridDropTarget(target);
	assert.ok(gridDropTargets().includes(target));
	stop();
	assert.ok(!gridDropTargets().includes(target));
});
