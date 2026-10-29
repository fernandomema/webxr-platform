import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { diffTrees, formatTreeDiff, isEmptyDiff } from '../packages/engine/src/document/diff.ts';

const base = () => [
	createSlot({ id: 'root', name: 'Root' }),
	createSlot({ id: 'a', parentId: 'root', name: 'Lamp', position: [0, 1, 0], components: [{ type: 'pointLight', intensity: 1 }, { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#fff' }] }),
	createSlot({ id: 'b', parentId: 'root', name: 'Gone' })
];

test('identical trees have an empty diff', () => {
	assert.ok(isEmptyDiff(diffTrees(base(), base())));
	assert.equal(formatTreeDiff(diffTrees(base(), base())), 'No changes.');
});

test('moves, component edits, additions and removals are found by slot id', () => {
	const after = base().filter((slot) => slot.id !== 'b');
	after[1].position = [0, 2, 0];
	after[1].components[0].intensity = 3;
	after[1].components[1].meshRef = { kind: 'builtin', id: 'sphere' };
	after[1].components.push({ type: 'collider', shape: 'box' });
	after.push(createSlot({ id: 'c', parentId: 'a', name: 'Bulb' }));
	const diff = diffTrees(base(), after);
	assert.equal(diff.removed[0].slot.id, 'b');
	assert.deepEqual(diff.added[0].path, ['Root', 'Lamp', 'Bulb']);
	const [lamp] = diff.changed;
	assert.deepEqual(lamp.fields, [{ path: 'position', before: [0, 1, 0], after: [0, 2, 0] }]);
	assert.deepEqual(lamp.components.map((c) => [c.type, c.kind]), [['pointLight', 'changed'], ['meshRenderer', 'changed'], ['collider', 'added']]);
	assert.equal(lamp.components[1].fields[0].path, 'meshRef.id');
	const text = formatTreeDiff(diff);
	assert.match(text, /1 modified, 1 added, 1 removed/);
	assert.match(text, /`position`: \[0,1,0\] → \[0,2,0\]/);
	assert.match(text, /`pointLight.intensity`: 1 → 3/);
});

test('multi-line strings such as scripts are shown whole, before and after', () => {
	const before = [createSlot({ id: 'x', name: 'X', components: [{ type: 'codeBlock', code: 'a\nb' }] })];
	const after = [createSlot({ id: 'x', name: 'X', components: [{ type: 'codeBlock', code: 'a\nc' }] })];
	const text = formatTreeDiff(diffTrees(before, after));
	assert.match(text, /codeBlock\.code` \(before\)/);
	assert.match(text, /a\nc/);
});
