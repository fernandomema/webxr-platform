import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = (specifier.startsWith('.') || specifier.startsWith('file:')) && !/\.(ts|js|mjs|json)$/.test(specifier) ? `${specifier}.ts` : specifier;
    return nextResolve(resolved, context);
  }
});

const { describeToolCall, summarizeActivity } = await import('../src/lib/studio/ai/activity.ts');
const { parseBlocks, parseInline } = await import('../src/lib/studio/ai/markdown.ts');

const slot = (id, name, components = []) => ({ id, parentId: null, name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });
const tree = [slot('h', 'Head', [{ type: 'meshRenderer', color: '#fff' }])];

test('reading tools are described as looking, not as tool names', () => {
  assert.deepEqual(describeToolCall('list_scene', {}, tree, {}), { kind: 'read', text: 'Looked at the scene', tool: 'list_scene' });
  assert.equal(describeToolCall('inspect_slot', { id: 'h' }, tree, {}).text, 'Inspected Head');
  assert.equal(describeToolCall('get_component_schema', { type: 'grabbable' }, tree, {}).text, 'Checked how grabbable works');
});

test('edits name the object they touched, even one that is gone after the call', () => {
  assert.equal(describeToolCall('stage_set_component_field', { id: 'h', index: 0, field: 'color', value: '#f00' }, tree, {}).text, 'Changed the color of Head');
  assert.equal(describeToolCall('stage_delete_slot', { id: 'h' }, tree, {}).text, 'Deleted Head');
  assert.equal(describeToolCall('stage_update_slot', { id: 'h', patch: { position: [1, 0, 0] } }, tree, {}).text, 'Moved Head');
  assert.equal(describeToolCall('stage_remove_component', { id: 'h', index: 0 }, tree, {}).text, 'Removed meshRenderer from Head');
  assert.equal(describeToolCall('stage_subtree', { parentId: null, slots: [{ name: 'Table' }, { name: 'Leg' }] }, tree, {}).text, 'Created Table (2 parts)');
});

test('a batch of colour edits reads as a recolour', () => {
  const edits = [1, 2, 3].map(() => ({ id: 'h', index: 0, field: 'color', value: '#000' }));
  assert.equal(describeToolCall('stage_set_component_fields', { edits }, tree, {}).text, 'Recolored 3 parts');
  assert.equal(describeToolCall('stage_set_component_fields', { edits: [{ field: 'scalable' }] }, tree, {}).text, 'Changed 1 property');
});

test('a tool error becomes a quiet retry', () => {
  const item = describeToolCall('stage_subtree', {}, tree, { error: 'Invalid mesh reference' });
  assert.equal(item.kind, 'retry');
  assert.match(item.text, /Invalid mesh reference/);
});

test('a run is summarised in one short line', () => {
  const items = [{ kind: 'read' }, { kind: 'read' }, { kind: 'change' }, { kind: 'retry' }];
  assert.equal(summarizeActivity(items), '1 change · looked around 2 times');
  assert.equal(summarizeActivity([]), 'No actions');
});

test('replies render bold, code and lists as data, never as HTML', () => {
  assert.deepEqual(parseInline('a **b** `c` d'), [{ kind: 'text', value: 'a ' }, { kind: 'bold', value: 'b' }, { kind: 'text', value: ' ' }, { kind: 'code', value: 'c' }, { kind: 'text', value: ' d' }]);
  const blocks = parseBlocks('Done.\n\n- **Body:** violet\n- Head: mint\n\nBye');
  assert.deepEqual(blocks.map((block) => block.type), ['p', 'ul', 'p']);
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(parseInline('<img src=x onerror=alert(1)>'), [{ kind: 'text', value: '<img src=x onerror=alert(1)>' }]);
});

test('texture work reads as searching, importing and applying', () => {
  assert.equal(describeToolCall('search_assets', { kind: 'material', query: 'old brick' }, tree, { total: 3 }).text, 'Searched for material “old brick”');
  assert.deepEqual(describeToolCall('import_asset', { ref: 'polyhaven:brick_wall_002' }, tree, { name: 'Brick Wall 002' }), { kind: 'import', text: 'Imported Brick Wall 002', tool: 'import_asset' });
  assert.equal(describeToolCall('stage_set_material', { id: 'h' }, tree, { applied: true }).text, 'Put a material on Head');
  assert.equal(summarizeActivity([{ kind: 'read' }, { kind: 'import' }, { kind: 'change' }]), '1 change · imported 1 file · looked around 1 time');
});
