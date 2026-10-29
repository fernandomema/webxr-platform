import assert from 'node:assert/strict';
import test from 'node:test';
import { PROTOCOL_ADAPTERS } from '../src/lib/studio/ai/adapters.ts';

const tools = [{ name: 'a', description: 'd', parameters: {} }, { name: 'b', description: 'd', parameters: {} }];

test('Claude requests mark the tools, the instructions and the latest message as cacheable without touching the stored conversation', () => {
	const wire = [{ role: 'user', content: 'hi' }];
	const payload = PROTOCOL_ADAPTERS.messages.buildPayload('m', 'sys', wire, tools);
	assert.deepEqual(payload.system[0].cache_control, { type: 'ephemeral' });
	assert.equal(payload.tools[0].cache_control, undefined);
	assert.deepEqual(payload.tools[1].cache_control, { type: 'ephemeral' });
	assert.deepEqual(payload.messages[0].content[0].cache_control, { type: 'ephemeral' });
	assert.equal(wire[0].content, 'hi');
});

test('Claude usage counts cached tokens as part of the prompt', () => {
	const reply = PROTOCOL_ADAPTERS.messages.parseReply({ content: [], usage: { input_tokens: 10, cache_read_input_tokens: 800, cache_creation_input_tokens: 100, output_tokens: 5 } }, 'claude');
	assert.deepEqual(reply.usage, { input: 910, output: 5, cacheRead: 800, cacheWrite: 100 });
});

test('OpenAI requests carry a cache key and report cached tokens', () => {
	assert.equal(PROTOCOL_ADAPTERS.responses.buildPayload('m', 's', [], tools, { key: 'k' }).prompt_cache_key, 'k');
	const reply = PROTOCOL_ADAPTERS.responses.parseReply({ output: [], usage: { input_tokens: 50, output_tokens: 7, input_tokens_details: { cached_tokens: 40 } } }, 'openai');
	assert.deepEqual(reply.usage, { input: 50, output: 7, cacheRead: 40, cacheWrite: 0 });
});

test('chat usage is read from OpenAI-style and Ollama replies, and only Anthropic models on OpenRouter get cache breakpoints', () => {
	const reply = PROTOCOL_ADAPTERS.chat.parseReply({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 20, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 12 } } }, 'openrouter');
	assert.deepEqual(reply.usage, { input: 20, output: 3, cacheRead: 12, cacheWrite: 0 });
	assert.deepEqual(PROTOCOL_ADAPTERS.chat.parseReply({ message: { content: 'x' }, prompt_eval_count: 9, eval_count: 2 }, 'ollama').usage, { input: 9, output: 2, cacheRead: 0, cacheWrite: 0 });
	assert.equal(typeof PROTOCOL_ADAPTERS.chat.buildPayload('openai/gpt', 's', [], tools).messages[0].content, 'string');
	assert.equal(PROTOCOL_ADAPTERS.chat.buildPayload('anthropic/claude', 's', [], tools).messages[0].content[0].cache_control.type, 'ephemeral');
});

test('Claude over chat completions caches the instructions and the latest message, leaving the stored conversation alone', () => {
  const wire = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'again' }];
  const payload = PROTOCOL_ADAPTERS.chat.buildPayload('anthropic/claude-sonnet-5-5', 's', wire, tools, { key: 'k' });
  assert.equal(payload.messages[0].content[0].cache_control.type, 'ephemeral');
  assert.equal(payload.messages[3].content[0].cache_control.type, 'ephemeral');
  assert.equal(payload.messages[1].content, 'hi');
  assert.equal(wire[2].content, 'again');
  assert.equal(payload.prompt_cache_key, undefined);
});

test('OpenAI models over chat completions get a cache key', () => {
  assert.equal(PROTOCOL_ADAPTERS.chat.buildPayload('openai/gpt-6.1-terra', 's', [], tools, { key: 'k' }).prompt_cache_key, 'k');
  assert.equal(PROTOCOL_ADAPTERS.chat.buildPayload('openai/gpt-6.1-terra', 's', [], tools).prompt_cache_key, undefined);
});
