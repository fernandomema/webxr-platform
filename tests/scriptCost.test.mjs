import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptCostHints, scriptCostScore, SCRIPT_COST_WARNING } from '../packages/engine/src/worlds/scriptCost.ts';
import { lintWorld } from '../packages/engine/src/worlds/lint.ts';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { buildJukebox } from '../src/lib/content/templates/jukebox.ts';

const kinds = (code) => scriptCostHints(code).map((h) => [h.line, h.kind, h.severity]);

test('reads of the world in tick, and in what tick calls, are found with their line', () => {
  const code = [
    'function occupant(id) {',
    '  const slot = ctx.hierarchy.getSlot(id);',
    '  return slot.components.find((c) => c.type === "socket").occupantId;',
    '}',
    'function busy() { return IDS.some((id) => occupant(id)); }',
    'return {',
    '  onSpawn() { ctx.hierarchy.getSlot("x"); },',
    '  tick(dt) { if (busy()) ctx.log(ctx.hierarchy.findByName("Lamp")); }',
    '};'
  ].join('\n');
  assert.deepEqual(kinds(code), [[2, 'slot-read', 'info'], [3, 'components-walk', 'info'], [8, 'world-scan', 'info']]);
  const messages = scriptCostHints(code).map((h) => h.message);
  assert.match(messages[0], /in occupant\(\), which tick runs every frame/);
  assert.match(messages[0], /getField/);
});

test('in a loop it is a warning, and onSpawn or other handlers are left alone', () => {
  const code = 'return { onSpawn() { ctx.hierarchy.getSlot("a"); }, tick() { for (const id of IDS) ctx.hierarchy.getSlot(id); ctx.math.vecAdd([0,0,0],[1,1,1]); } };';
  assert.deepEqual(kinds(code), [[1, 'slot-read', 'warning']], 'math outside a loop is not worth a hint');
  assert.deepEqual(kinds('return { tick() { IDS.forEach((id) => ctx.math.vecAdd(P[id], Q)); } };'), [[1, 'math-call', 'info']]);
});

test('a tick that waits between runs only gets hints', () => {
  const code = 'let every = 0;\nreturn { tick(dt) {\n  every -= dt; if (every > 0) return; every = 0.5;\n  for (const id of IDS) ctx.hierarchy.getSlot(id);\n} };';
  const [hint] = scriptCostHints(code);
  assert.equal(hint.severity, 'info');
  assert.ok(hint.throttled);
  assert.match(hint.message, /it waits between runs/);
});

test('field reads, scripts without tick and broken code give nothing', () => {
  assert.deepEqual(scriptCostHints('return { tick() { const o = ctx.hierarchy.getField("s", "socket", "occupantId"); ctx.self.getField("scriptState", "data"); } };'), []);
  assert.deepEqual(scriptCostHints('return { onPress() { ctx.hierarchy.getSlot("a").components.find((c) => c); } };'), []);
  assert.deepEqual(scriptCostHints('return { tick( };'), []);
});

test('the world lint warns once per costly script, and the jukebox is not one', () => {
  const costly = 'function read(i) { return ctx.hierarchy.getSlot(IDS[i]).components.find((c) => c.type === "socket"); }\nreturn { tick() { for (let i = 0; i < 6; i++) read(i); IDS.forEach((id) => ctx.hierarchy.getSlot(id).components); } };';
  assert.ok(scriptCostScore(scriptCostHints(costly)) >= SCRIPT_COST_WARNING);
  const findings = lintWorld([createSlot({ id: 'box', components: [{ type: 'codeBlock', code: costly }] })]).filter((f) => f.rule === 'script-cost');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'warning');
  assert.match(findings[0].message, /every frame/);
  const jukebox = buildJukebox().find((s) => s.id === 'jukebox-panel').components.find((c) => c.type === 'codeBlock').code;
  assert.deepEqual(scriptCostHints(jukebox), []);
});

test('the Studio code lint shows them as performance hints on their line', async () => {
  const { lintCode } = await import('../src/lib/studio/lint/code.ts');
  const found = lintCode('return {\n  tick() {\n    for (const id of IDS) ctx.hierarchy.getSlot(id);\n  }\n};');
  assert.deepEqual(found.map((d) => [d.line, d.severity]), [[3, 'warning']]);
  assert.match(found[0].message, /^Performance: /);
});
