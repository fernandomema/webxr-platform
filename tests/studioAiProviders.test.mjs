import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = specifier.startsWith('.') && !/\.(ts|js|mjs)$/.test(specifier) ? `${specifier}.ts` : specifier;
    return nextResolve(target, context);
  }
});
const { ProviderConversation, FreeLLMAPIConnectionError, defaultProfile } = await import('../src/lib/studio/ai/providers.ts');

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

test('FreeLLMAPI sends auto:fast and linked tool results directly to its local proxy', async () => {
  const profile = { ...defaultProfile('freellmapi'), model: 'auto:fast' };
  const conversation = new ProviderConversation(profile, 'Studio editor');
  conversation.addUser('List the scene');
  await withResponses([
    { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'free-call', type: 'function', function: { name: 'list_scene', arguments: '{}' } }] } }] },
    { choices: [{ message: { role: 'assistant', content: 'Done.' } }] }
  ], async (requests) => {
    const first = await conversation.step('freellmapi-test-key', [tool], new AbortController().signal);
    assert.deepEqual(first.calls, [{ id: 'free-call', name: 'list_scene', arguments: {} }]);
    conversation.addResults([{ call: first.calls[0], output: { slots: [] } }]);
    const second = await conversation.step('freellmapi-test-key', [tool], new AbortController().signal);
    assert.equal(second.text, 'Done.');
    assert.ok(requests.every((request) => request.url === 'http://127.0.0.1:31415/v1/chat/completions'));
    assert.equal(requests[0].headers.authorization, 'Bearer freellmapi-test-key');
    assert.equal(requests[0].body.model, 'auto:fast');
    assert.equal(requests[0].body.tools[0].function.name, 'list_scene');
    assert.deepEqual(requests[1].body.messages.at(-1), { role: 'tool', tool_call_id: 'free-call', name: 'list_scene', content: '{"slots":[]}' });
  });
});

test('FreeLLMAPI uses each protocol endpoint and authentication format', async (t) => {
  const replies = {
    chat: { choices: [{ message: { role: 'assistant', content: 'Hello.' } }] },
    responses: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello.' }] }] },
    messages: { content: [{ type: 'text', text: 'Hello.' }] }
  };
  for (const protocol of ['chat', 'responses', 'messages']) {
    await t.test(protocol, async () => {
      const profile = { ...defaultProfile('freellmapi'), protocol, endpoint: 'https://proxy.example/router/v1/' };
      const conversation = new ProviderConversation(profile, 'Studio editor');
      conversation.addUser('Hello');
      await withResponses([replies[protocol]], async (requests) => {
        const response = await conversation.step('freellmapi-test-key', [tool], new AbortController().signal);
        assert.equal(response.text, 'Hello.');
        assert.equal(requests[0].url, `https://proxy.example/router/v1/${protocol === 'chat' ? 'chat/completions' : protocol}`);
        assert.equal(requests[0].body.model, 'auto');
        if (protocol === 'messages') {
          assert.equal(requests[0].headers['x-api-key'], 'freellmapi-test-key');
          assert.equal(requests[0].headers['anthropic-version'], '2023-06-01');
        } else {
          assert.equal(requests[0].headers.authorization, 'Bearer freellmapi-test-key');
        }
      });
    });
  }
});

test('FreeLLMAPI falls back to its local base URL and rejects unsafe remote endpoints', async () => {
  const conversation = new ProviderConversation({ ...defaultProfile('freellmapi'), endpoint: '' }, 'Studio editor');
  conversation.addUser('Hello');
  await withResponses([{ choices: [{ message: { role: 'assistant', content: 'Hello.' } }] }], async (requests) => {
    await conversation.step('freellmapi-test-key', [], new AbortController().signal);
    assert.equal(requests[0].url, 'http://127.0.0.1:31415/v1/chat/completions');
  });
  await withResponses([], async (requests) => {
    for (const endpoint of ['http://proxy.example/v1', 'https://user:password@proxy.example/v1']) {
      const unsafe = new ProviderConversation({ ...defaultProfile('freellmapi'), endpoint }, 'Studio editor');
      await assert.rejects(unsafe.step('freellmapi-test-key', [], new AbortController().signal), /HTTPS|API key field/);
    }
    assert.equal(requests.length, 0);
  });
});

test('FreeLLMAPI reports browser connection failures without retrying through the server', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    throw new TypeError('Failed to fetch');
  };
  try {
    const conversation = new ProviderConversation(defaultProfile('freellmapi'), 'Studio editor');
    conversation.addUser('Hello');
    await assert.rejects(conversation.step('test-key', [], new AbortController().signal), (error) => {
      assert.ok(error instanceof FreeLLMAPIConnectionError);
      assert.match(error.message, /CORS/);
      assert.match(error.message, /local network permission/);
      return true;
    });
    assert.deepEqual(requests, ['http://127.0.0.1:31415/v1/chat/completions']);
  } finally { globalThis.fetch = original; }
});

test('FreeLLMAPI cancellation preserves the abort error instead of reporting a connection failure', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const abortError = new DOMException('Request cancelled', 'AbortError');
  globalThis.fetch = async () => {
    controller.abort(abortError);
    throw abortError;
  };
  try {
    const conversation = new ProviderConversation(defaultProfile('freellmapi'), 'Studio editor');
    await assert.rejects(conversation.step('test-key', [], controller.signal), (error) => error === abortError);
  } finally { globalThis.fetch = original; }
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
