import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { MeshBuilder, NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { resolveRelativeImports } from './helpers/resolveSpecifiers.mjs';

const coreUrl = import.meta.resolve('@babylonjs/core');
const libUrl = new URL('../packages/engine/src/', import.meta.url);
const compiled = ts.transpileModule(await readFile(new URL('xr/interaction/equipmentSystem.ts', libUrl), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(coreUrl))
	.replaceAll("'./equipmentRegistry.ts'", JSON.stringify(new URL('xr/interaction/equipmentRegistry.ts', libUrl).href));
const { EquipmentSystem } = await import(`data:text/javascript;base64,${Buffer.from(resolveRelativeImports(compiled, new URL('xr/interaction/equipmentSystem.ts', libUrl))).toString('base64')}`);

test('an equipped object cannot be picked, so the laser of the hand holding it reaches what is behind it; it can again once let go', () => {
	const engine = new NullEngine();
	const scene = new Scene(engine);
	const gun = new TransformNode('gun', scene);
	const body = MeshBuilder.CreateBox('body', { size: 0.1 }, scene);
	const ghost = MeshBuilder.CreateBox('ghost', { size: 0.1 }, scene);
	body.parent = gun; ghost.parent = gun;
	ghost.isPickable = false;           // already not pickable: it must stay that way
	const slot = { id: 'gun', parentId: null, components: [{ type: 'equippable', left: { position: [0, 0, 0], rotation: [0, 0, 0] }, right: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
	const live = { slot, node: gun };
	const graph = { getLive: (id) => (id === 'gun' ? live : undefined), setEquipQuery() {}, getSubtree: () => [] };
	const grab = { setGuard() {}, getGrabbersForSlot: () => [], getHeldSlot: () => null, detach: () => null };
	const system = new EquipmentSystem(scene, graph, grab, () => 'me', () => 'Me');
	const hand = new TransformNode('hand', scene);
	assert.equal(body.isPickable, true);
	assert.ok(system.equip('me', 'right', hand, 'gun'));
	assert.equal(body.isPickable, false, 'the laser goes through it');
	system.unequip('me', 'right');
	assert.equal(body.isPickable, true, 'it can be picked again');
	assert.equal(ghost.isPickable, false, 'what was not pickable before is left alone');
	scene.dispose(); engine.dispose();
});
