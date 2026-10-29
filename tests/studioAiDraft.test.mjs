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

const mesh = (id, color) => ({ ...slot(id, null, id), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color }] });

test('one batch call recolours many components, and the call counts as a single edit', () => {
  const draft = new StudioDraft([mesh('a', '#111111'), mesh('b', '#222222'), mesh('c', '#333333')], null);
  const result = draft.call('stage_set_component_fields', { edits: ['a', 'b', 'c'].map((id) => ({ id, index: 0, field: 'color', value: '#ff0000' })) });
  assert.equal(result.changed, true);
  assert.deepEqual(draft.tree.map((item) => item.components[0].color), ['#ff0000', '#ff0000', '#ff0000']);
});

test('a batch with one bad edit stages nothing and says which one failed', () => {
  const draft = new StudioDraft([mesh('a', '#111111'), mesh('b', '#222222')], null);
  assert.throws(() => draft.call('stage_set_component_fields', { edits: [{ id: 'a', index: 0, field: 'color', value: '#ff0000' }, { id: 'missing', index: 0, field: 'color', value: '#ff0000' }] }), /edits\[1\].*Nothing was changed/);
  assert.equal(draft.changed, false);
});

test('a batch of slot patches applies together or not at all', () => {
  const draft = new StudioDraft([mesh('a', '#111111'), mesh('b', '#222222')], null);
  draft.call('stage_update_slots', { updates: [{ id: 'a', patch: { name: 'First' } }, { id: 'b', patch: { scale: [2, 2, 2] } }] });
  assert.deepEqual(draft.tree.map((item) => item.name), ['First', 'b']);
  assert.throws(() => draft.call('stage_update_slots', { updates: [{ id: 'a', patch: { name: 'X' } }, { id: 'nope', patch: { name: 'Y' } }] }), /updates\[1\]/);
  assert.equal(draft.tree[0].name, 'First');
});

test('edits continue from the scene as it is now, so a change the person made between steps is kept', () => {
  const draft = new StudioDraft([mesh('a', '#111111')], null);
  draft.call('stage_set_component_field', { id: 'a', index: 0, field: 'color', value: '#ff0000' });
  const edited = draft.tree.map((item) => ({ ...item, name: 'Renamed by the person' }));
  draft.sync(edited);
  draft.call('stage_set_component_field', { id: 'a', index: 0, field: 'color', value: '#00ff00' });
  assert.equal(draft.tree[0].name, 'Renamed by the person');
  assert.equal(draft.tree[0].components[0].color, '#00ff00');
});

test('tool results say the edit was applied, not staged for later', () => {
  const draft = new StudioDraft([mesh('a', '#111111')], null);
  const value = draft.call('stage_set_component_field', { id: 'a', index: 0, field: 'color', value: '#ff0000' }).value;
  assert.equal(value.applied, true);
  assert.equal(JSON.stringify(draft.call('list_scene', {}).value).includes('Apply'), false);
});

const ASSET = `sha256:${'a'.repeat(64)}`;

test('a material is added to a built-in shape with the maps as references, and a second call updates it', () => {
  const draft = new StudioDraft([mesh('wall', '#ffffff')], null);
  draft.call('stage_set_material', { id: 'wall', albedo: ASSET, normal: 'https://example.com/n.jpg', mapping: 'world', size: 2 });
  const material = draft.tree[0].components.find((component) => component.type === 'material');
  assert.deepEqual(material.albedo, { kind: 'asset', assetId: ASSET });
  assert.deepEqual(material.normal, { kind: 'url', url: 'https://example.com/n.jpg' });
  assert.equal(material.mapping, 'world');
  draft.call('stage_set_material', { id: 'wall', roughness: 0.4, normal: null });
  const after = draft.tree[0].components.filter((component) => component.type === 'material');
  assert.equal(after.length, 1, 'one material, updated in place');
  assert.equal(after[0].roughness, 0.4);
  assert.equal('normal' in after[0], false);
  assert.deepEqual(after[0].albedo, { kind: 'asset', assetId: ASSET }, 'what was not mentioned is kept');
});

test('a material refuses what it can not apply to, with a reason the agent can act on', () => {
  const draft = new StudioDraft([mesh('wall', '#ffffff'), slot('empty', null, 'Empty')], null);
  assert.throws(() => draft.call('stage_set_material', { id: 'empty', albedo: ASSET }), /meshRenderer/);
  assert.throws(() => draft.call('stage_set_material', { id: 'wall', albedo: 'not a picture' }), /asset id/);
  assert.throws(() => draft.call('stage_set_material', { id: 'wall', albedo: 'http://insecure.example/x.jpg' }), /asset id/);
  assert.throws(() => draft.call('stage_set_material', { id: 'wall', roughness: 3 }), /roughness/);
  assert.throws(() => draft.call('stage_set_material', { id: 'wall', mapping: 'sideways' }), /mapping/);
  assert.equal(draft.changed, false);
});

test('the texture tools that fetch are the browser\'s to run, the material tool is the draft\'s', async () => {
  const { isRemoteTool, STUDIO_TOOLS } = await import('../src/lib/studio/ai/tools.ts');
  assert.deepEqual(['search_assets', 'import_asset', 'stage_set_material'].map(isRemoteTool), [true, true, false]);
  for (const name of ['search_assets', 'import_asset', 'stage_set_material']) assert.ok(STUDIO_TOOLS.some((tool) => tool.name === name), name);
});
