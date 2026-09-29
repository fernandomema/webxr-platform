import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const libRoot = new URL('../src/lib/', import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith('$lib/') ? new URL(specifier.slice(5), libRoot).href : specifier;
    const resolved = (target.startsWith('.') || target.startsWith('file:')) && !/\.(ts|js|mjs|json)$/.test(target) ? `${target}.ts` : target;
    return nextResolve(resolved, context);
  }
});

const { StudioDraft } = await import('../src/lib/studio/ai/tools.ts');

const root = { id: 'root', parentId: null, name: 'Root', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'container' }] };
const slot = (id, parentId, name) => ({ id, parentId, name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] });

test('AI staging inserts one grouped subtree without modifying the open tree', () => {
  const source = [root];
  const draft = new StudioDraft(source, root.id);
  draft.call('stage_subtree', { parentId: 'root', slots: [slot('table', null, 'Table'), slot('ball', 'table', 'Ball')] });
  assert.equal(source.length, 1);
  assert.equal(draft.tree.length, 3);
  const table = draft.tree.find((item) => item.name === 'Table');
  const ball = draft.tree.find((item) => item.name === 'Ball');
  assert.equal(table.parentId, 'root');
  assert.equal(ball.parentId, table.id);
  assert.notEqual(table.id, 'table');
  assert.deepEqual(draft.diagnostics.filter((issue) => issue.severity === 'error'), []);
});

test('AI staging rejects malformed transforms and cycles', () => {
  const draft = new StudioDraft([root], root.id);
  assert.throws(() => draft.call('stage_update_slot', { id: root.id, patch: { position: [NaN, 0, 0] } }), /finite/);
  assert.throws(() => draft.call('stage_subtree', { parentId: root.id, slots: [slot('a', 'b', 'A'), slot('b', 'a', 'B')] }), /cycle/);
  assert.equal(draft.tree.length, 1);
});

test('existing component issues do not block unrelated staged changes', () => {
  const original = { ...root, components: [{ type: 'velocity', linear: [0, 0, 0], drag: 1.4 }] };
  const draft = new StudioDraft([original], original.id);
  draft.call('stage_subtree', { parentId: original.id, slots: [slot('child', null, 'Child')] });
  assert.equal(draft.tree.length, 2);
  assert.ok(draft.diagnostics.some((issue) => issue.message.includes('velocity.drag')));
});

test('AI read tools expose paginated full JSON and refuse removing the only root', () => {
  const draft = new StudioDraft([root], root.id);
  const page = draft.call('read_scene_json', { offset: 0, limit: 1 }).value;
  assert.equal(page.slots[0].components[0].type, 'container');
  assert.throws(() => draft.call('stage_delete_slot', { id: root.id }), /Cannot delete/);
});

test('semantic component edits preserve other components and reject unknown fields', () => {
  const draft = new StudioDraft([root], root.id);
  draft.call('stage_add_component', { id: root.id, component: { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#ffffff' } });
  assert.equal(draft.tree[0].components[0].type, 'container');
  draft.call('stage_set_component_field', { id: root.id, index: 1, field: 'color', value: '#ff0000' });
  assert.equal(draft.tree[0].components[1].color, '#ff0000');
  assert.throws(() => draft.call('stage_set_component_field', { id: root.id, index: 1, field: 'unknown', value: 1 }), /Unknown/);
  draft.call('stage_remove_component', { id: root.id, index: 1 });
  assert.deepEqual(draft.tree[0].components, [{ type: 'container' }]);
});

test('semantic reparenting rejects cycles', () => {
  const draft = new StudioDraft([root, slot('child', root.id, 'Child')], root.id);
  assert.throws(() => draft.call('stage_reparent_slot', { id: root.id, parentId: 'child' }), /cycle/);
  draft.call('stage_reparent_slot', { id: 'child', parentId: null });
  assert.equal(draft.tree[1].parentId, null);
});
