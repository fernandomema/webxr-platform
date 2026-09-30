import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

const workshop = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/workshop.json', import.meta.url), 'utf8'));
const find = (slot, type) => slot.components.find((c) => c.type === type);
const meshId = (slot) => find(slot, 'meshRenderer')?.meshRef.id;
const isFloor = (slot) => meshId(slot) === 'ground' || meshId(slot) === 'disc';
// The same rule as playerBody.isSolidSlot: a collider you cannot pick up that is not a floor.
const isSolid = (slot) => Boolean(find(slot, 'collider')) && !find(slot, 'grabbable') && !isFloor(slot) && Boolean(find(slot, 'meshRenderer'));

/** World-space box of a box slot (groups sit at the origin untransformed, so a slot's own transform is its world one). */
const bounds = (slot) => ({ min: slot.position.map((p, i) => p - slot.scale[i] / 2), max: slot.position.map((p, i) => p + slot.scale[i] / 2) });

test('the workshop is a valid world scene', () => {
	assert.ok(workshop.length > 0 && workshop.length <= 2000);
	assert.ok(JSON.stringify(workshop).length < 1_500_000, 'small enough to host and share');
	const ids = new Set();
	for (const slot of workshop) {
		assert.ok(typeof slot.id === 'string' && slot.id && !ids.has(slot.id), `unique id ${slot.id}`);
		ids.add(slot.id);
		assert.equal(slot.position.length, 3);
		assert.equal(slot.rotation.length, 4);
		assert.equal(slot.scale.length, 3);
		for (const component of slot.components) {
			if (component.type === 'meshRenderer') assert.ok(component.meshRef.kind === 'builtin' && isBuiltinMeshId(component.meshRef.id), `${slot.id} uses a built-in mesh`);
		}
	}
	for (const slot of workshop) if (slot.parentId !== null) assert.ok(ids.has(slot.parentId), `${slot.id} has its parent`);
	for (const group of workshop.filter((slot) => find(slot, 'container') && !find(slot, 'grabbable'))) {
		assert.deepEqual([group.position, group.rotation, group.scale], [[0, 0, 0], [0, 0, 0, 1], [1, 1, 1]], `${group.id} does not move what it groups`);
	}
	assert.equal(workshop.filter((slot) => find(slot, 'skybox')).length, 1);
});

test('a player arriving at the origin stands on the floor, clear of anything solid, with a clear way to the stage', () => {
	const floor = workshop.find((slot) => slot.id === 'floor');
	assert.equal(meshId(floor), 'ground');
	const half = [floor.scale[0] * 10, floor.scale[2] * 10];
	assert.ok(Math.abs(floor.position[0]) + 1 < half[0] && Math.abs(floor.position[2]) + 1 < half[1], 'the origin is well inside the floor');
	// The aisle down the middle of the hall, at knee and chest height, from the arrival pad to the stage.
	const aisle = { min: [-1, 0.3, -26], max: [1, 1.8, 3] };
	for (const slot of workshop.filter((s) => isSolid(s) && meshId(s) === 'box')) {
		const b = bounds(slot);
		const overlaps = [0, 1, 2].every((i) => b.min[i] < aisle.max[i] && b.max[i] > aisle.min[i]);
		assert.ok(!overlaps, `${slot.id} blocks the aisle`);
	}
});

test('every raised floor can be stepped onto from the one below it', () => {
	const heights = [...new Set(workshop.filter(isFloor).map((slot) => slot.position[1]))].sort((a, b) => a - b);
	for (let i = 1; i < heights.length; i++) assert.ok(heights[i] - heights[i - 1] <= 0.4, `a ${heights[i] - heights[i - 1]} m step is too tall to walk up`);
});

test('each work bay has a bench, shelving and a sign that faces into the hall', () => {
	const bays = workshop.filter((slot) => slot.name.startsWith('Bay: '));
	assert.equal(bays.length, 6);
	for (const bay of bays) {
		const parts = workshop.filter((slot) => slot.parentId === bay.id);
		assert.ok(parts.some((slot) => slot.name.endsWith('Workbench Top') && isSolid(slot)), `${bay.name} has a workbench`);
		assert.ok(parts.filter((slot) => slot.name.includes('Shelf ')).length >= 3, `${bay.name} has shelves`);
		const sign = parts.find((slot) => find(slot, 'textDisplay'));
		assert.ok(sign, `${bay.name} has a sign`);
		// A plane is read from the side its -Z faces: turned by the sign's rotation, that must point towards the middle.
		const [x, y, z, w] = sign.rotation;
		const facingX = -(2 * (x * z + w * y));
		assert.ok(Math.sign(facingX) === -Math.sign(sign.position[0]), `${bay.name}'s sign faces the middle of the hall`);
	}
});
