import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { validateWorldScene } from '../packages/engine/src/worlds/package.ts';

test('a world can set how fast the player walks, runs and falls', () => {
	const scene = [createSlot({ id: 'm', name: 'm', components: [{ type: 'playerMovement', jumpSpeed: 22, gravity: 100, terminalSpeed: 60, walkSpeed: 8, runSpeed: 8 }] })];
	assert.doesNotThrow(() => validateWorldScene(scene));
});
