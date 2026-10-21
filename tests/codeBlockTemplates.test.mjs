import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TransformNode, NullEngine, Scene } from '@babylonjs/core';
import { createCodeBlockHandlers } from './helpers/codeBlockRuntimeModule.mjs';
import { buildBistro } from '../src/lib/xr/templates/bistro.ts';
import { buildDeadDrop } from '../src/lib/xr/templates/deadDrop.ts';
import { buildArcade } from '../src/lib/xr/templates/arcade.ts';
import { buildBeatTurntable } from '../src/lib/xr/templates/beatTurntable.ts';
import { buildArchiveJukebox } from '../src/lib/xr/templates/archiveJukebox.ts';
import { buildPolyHeavenMaterials } from '../src/lib/xr/templates/polyHeavenMaterials.ts';
import { buildWishEngine } from '../src/lib/xr/templates/wishEngine.ts';

const json = async (name) => JSON.parse(await readFile(new URL(`../src/lib/xr/templates/${name}.json`, import.meta.url), 'utf8'));
const worlds = {
	lobby: await json('lobby'), workshop: await json('workshop'), pulse: await json('pulse'), 'pop-up-store': await json('popUpStore'), keyboard: await json('keyboard'), avatarShowcase: await json('avatarShowcase'),
	bistro: buildBistro(), 'dead-drop': buildDeadDrop(), arcade: buildArcade(), 'beat-turntable': buildBeatTurntable(), 'archive-jukebox': buildArchiveJukebox(), 'polyheaven-materials': buildPolyHeavenMaterials(), 'wish-engine': buildWishEngine()
};

/** What a script that needs an engine we do not have here can legitimately hit; anything else means the sandbox lacks something scripts use. */
const MISSING_PAGE = /is not defined|is not a function|Cannot read properties of undefined|not available/;

let total = 0;

for (const [name, tree] of Object.entries(worlds)) {
	test(`every code block of the ${name} world compiles and starts inside the sandbox, and only asks the sandbox for what it has`, async () => {
		const scene = new Scene(new NullEngine());
		const slots = Object.fromEntries(tree.map((slot) => [slot.id, slot]));
		const node = new TransformNode('n', scene);
		const host = {
			getSlot: (id) => slots[id], getNode: () => node, getChildren: (parent) => tree.filter((slot) => slot.parentId === parent), allSlots: () => tree,
			getGrabbers: () => [], isHost: () => true, requestSpawn() {}, requestDelete() {}, setComponentField() {}, setComponent: () => true, removeComponent: () => true,
			findNear: () => [], raycast: () => null, overlap: () => [], getPlayers: () => [{ id: 'p1', name: 'P1', role: 'host' }], getPlayerPose: () => null, resolvePlayer: (id) => ({ id, name: id }),
			getEquipHolder: () => null, getUIMedia: () => undefined, getUIInputText: () => undefined, setSlotEnabled: () => true, commitTransform() {}, reparent: () => true, teleportPlayer: () => false
		};
		const runtimes = [];
		let blocks = 0;
		for (const slot of tree) {
			for (const component of slot.components) {
				if (component.type !== 'codeBlock') continue;
				blocks++;
				const runtime = createCodeBlockHandlers(slot.id, node, component.code, host);
				runtimes.push([slot.id, runtime]);
			}
		}
		total += blocks;
		for (const [, runtime] of runtimes) { runtime.tick?.(0.016); runtime.onPlayerReady?.({ id: 'p1', name: 'P1' }); }
		await new Promise((resolve) => setTimeout(resolve, 20));
		const problems = [];
		for (const [id, runtime] of runtimes) {
			for (const entry of runtime.getDebugLog()) if (entry.level === 'error' && (entry.hook === 'compile' || /is not defined/.test(entry.message))) problems.push(`${id} ${entry.hook}: ${entry.message}`);
		}
		for (const [, runtime] of runtimes) runtime.dispose();
		assert.deepEqual(problems, []);
	});
}

test('the template worlds together have many code blocks, so the checks above mean something', () => {
	assert.ok(total > 30, `only ${total} code blocks were checked`);
});

test('the only shipped scripts that call a route of our own site are the Feedback Center’s, and they call only the feedback route', () => {
	const own = /net\.(?:fetchJson|postJson)\(\s*['"`](\/[^'"`]*)/g;
	for (const [name, tree] of Object.entries(worlds)) {
		for (const slot of tree) {
			for (const component of slot.components) {
				if (component.type !== 'codeBlock') continue;
				for (const [, path] of component.code.matchAll(own)) assert.ok(name === 'pulse' && path === '/api/feedback', `${name}/${slot.id} calls ${path}`);
			}
		}
	}
	assert.ok(worlds.pulse.some((slot) => slot.components.some((c) => c.type === 'codeBlock' && c.code.includes("'/api/feedback'"))));
});
