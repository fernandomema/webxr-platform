import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

const file = new URL('../src/lib/studio/state/document.svelte.ts', import.meta.url);
const source = ts.transpileModule(await readFile(file, 'utf8'), {
 compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText;
const code = compileModule(source, { filename: file.pathname, generate: 'client' }).js.code
 .replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) => {
  const resolved = specifier.startsWith('.') ? new URL(`${specifier}.ts`, file).href : import.meta.resolve(specifier);
  return `from ${JSON.stringify(resolved)}`;
 });
const { StudioDocument } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('each transform drag is one undo step and preserves all local transform fields', () => {
 const original = { id: 'object', parentId: null, name: 'Object', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [] };
 const doc = new StudioDocument([original]);
 const position = [1, 2, 3], rotation = [0, Math.sin(0.123), 0, Math.cos(0.123)], scale = [2, 3, 4];
 doc.setTransform('object', position, rotation, scale);
 assert.deepEqual(doc.selected.position, position);
 assert.deepEqual(doc.selected.rotation, rotation);
 assert.deepEqual(doc.selected.scale, scale);
 assert.equal(doc.dirty, true);
 doc.undo();
 assert.deepEqual(doc.tree, [original]);
 assert.equal(doc.canUndo, false);
 assert.equal(doc.dirty, false);
 doc.redo();
 assert.deepEqual(doc.selected.rotation, rotation);
 assert.deepEqual(doc.selected.scale, scale);
 doc.setTransform('object', [9, 8, 7], rotation, scale);
 doc.undo();
 assert.deepEqual(doc.selected.position, position, 'two separate drags remain separate undo steps');
});
