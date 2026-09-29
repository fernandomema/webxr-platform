import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith('.') && !/\.(ts|js|mjs)$/.test(specifier) ? `${specifier}.ts` : specifier;
    return nextResolve(target, context);
  }
});
const { ProviderConversation, defaultProfile } = await import('../src/lib/studio/ai/providers.ts');

const tool = { name: 'list_scene', description: 'List slots', parameters: { type: 'object', properties: {} } };

async function withResponses(responses, run) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(requests); }
  finally { globalThis.fetch = original; }
}

test('OpenAI Responses keeps function calls and outputs linked by call_id', async () => {

  const profile = { ...defaultProfile('openai'), model: 'test-model' };
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('List the scene');
  await withResponses([
    { output: [{ type: 'function_call', call_id: 'call-1', name: 'list_scene', arguments: '{}' }] },
    { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] }
  ], async (requests) => {
    const first = await conversation.step('test-key', [tool], new AbortController().signal);
    assert.deepEqual(first.calls, [{ id: 'call-1', name: 'list_scene', arguments: {} }]);
    conversation.addResults([{ call: first.calls[0], output: { slots: [] } }]);
    const second = await conversation.step('test-key', [tool], new AbortController().signal);
    assert.equal(second.text, 'Done.');
    assert.deepEqual(requests[1].body.payload.input.at(-1), { type: 'function_call_output', call_id: 'call-1', output: '{"slots":[]}' });
    assert.equal(requests[0].headers['x-studio-session'], requests[1].headers['x-studio-session']);
  });
});

test('Claude groups parallel tool results in one user message', async () => {
  const profile = { ...defaultProfile('claude'), model: 'test-model' };
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('Inspect two slots');
  await withResponses([
    { content: [{ type: 'tool_use', id: 'a', name: 'list_scene', input: {} }, { type: 'tool_use', id: 'b', name: 'list_scene', input: {} }] },
    { content: [{ type: 'text', text: 'Found both.' }] }
  ], async (requests) => {
    const first = await conversation.step('test-key', [tool], new AbortController().signal);
    conversation.addResults(first.calls.map((call) => ({ call, output: { ok: true } })));
    const second = await conversation.step('test-key', [tool], new AbortController().signal);
    assert.equal(second.text, 'Found both.');
    assert.equal(requests[1].body.payload.messages.at(-1).content.length, 2);
    assert.deepEqual(requests[1].body.payload.messages.at(-1).content.map((item) => item.tool_use_id), ['a', 'b']);
  });
});

test('Ollama uses its direct endpoint and returns native tool calls', async () => {
  const profile = { ...defaultProfile('ollama'), model: 'local-model' };
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('List');
  await withResponses([{ message: { content: '', tool_calls: [{ function: { name: 'list_scene', arguments: {} } }] } }], async (requests) => {
    const result = await conversation.step('', [tool], new AbortController().signal);
    assert.equal(result.calls[0].name, 'list_scene');
    assert.equal(requests[0].url, 'http://localhost:11434/api/chat');
  });
});

test('custom HTTP remote endpoints are rejected before credentials leave the browser', async () => {
  const profile = { ...defaultProfile('custom'), model: 'custom-model', endpoint: 'http://example.com/v1/chat/completions' };
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('Hello');
  await assert.rejects(conversation.step('secret', [tool], new AbortController().signal), /HTTPS/);
});

test('OpenRouter uses chat completions and keeps tool call IDs across steps', async () => {
  const profile = { ...defaultProfile('openrouter'), model: 'vendor/model:free' };
  assert.equal(profile.protocol, 'chat');
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('List');
  await withResponses([
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'list_scene', arguments: '{}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Done.' } }] }
  ], async (requests) => {
    const first = await conversation.step('openrouter-key', [tool], new AbortController().signal);
    assert.deepEqual(first.calls, [{ id: 'call-1', name: 'list_scene', arguments: {} }]);
    conversation.addResults([{ call: first.calls[0], output: { slots: [] } }]);
    const second = await conversation.step('openrouter-key', [tool], new AbortController().signal);
    assert.equal(second.text, 'Done.');
    assert.equal(requests[0].url, '/api/studio/ai');
    assert.equal(requests[0].body.kind, 'openrouter');
    assert.equal(requests[0].body.protocol, 'chat');
    assert.equal(requests[0].body.payload.model, 'vendor/model:free');
    assert.equal(requests[0].body.payload.tools[0].function.name, 'list_scene');
    assert.deepEqual(requests[1].body.payload.messages.at(-1), { role: 'tool', tool_call_id: 'call-1', name: 'list_scene', content: '{"slots":[]}' });
  });
});
