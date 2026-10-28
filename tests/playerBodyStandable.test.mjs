import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { isFloorSlot, isSolidSlot } from '../packages/engine/src/xr/interaction/playerBody.ts';
import { validateWorldScene } from '../packages/engine/src/worlds/package.ts';

const box = (components) => createSlot({ id: 'b', name: 'b', components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#808080' }, ...components] });

test('a plain solid blocks the sides and is not a floor; a standable one is both', () => {
	const solid = box([{ type: 'collider', shape: 'box' }]);
	assert.equal(isSolidSlot(solid), true);
	assert.equal(isFloorSlot(solid), false);
	const platform = box([{ type: 'collider', shape: 'box', standable: true }]);
	assert.equal(isSolidSlot(platform), true, 'it still stops the sides');
	assert.equal(isFloorSlot(platform), true, 'and its upper surface is a floor');
	assert.equal(isFloorSlot(box([])), false, 'no collider, no floor');
});

test('a world can set how fast the player walks, runs and falls', () => {
	const scene = [createSlot({ id: 'm', name: 'm', components: [{ type: 'playerMovement', jumpSpeed: 22, gravity: 100, terminalSpeed: 60, walkSpeed: 8, runSpeed: 8 }] })];
	assert.doesNotThrow(() => validateWorldScene(scene));
});
