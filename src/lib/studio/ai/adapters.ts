import type { AgentCall, AgentTool, ProviderKind, ProviderProtocol } from './providers';

/** What one model call consumed. `input` counts every prompt token, `cacheRead` and `cacheWrite` are the parts of it served from / stored in the provider's prompt cache. */
export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export interface AdapterReply {
	text: string;
	calls: AgentCall[];
	wire: unknown[];
	usage: TokenUsage;
}

/** Hints a provider can use to reuse the prompt prefix between the steps of one run. */
export interface CacheHints {
	/** Stable per conversation: providers that route by key (OpenAI) hit the same cache more often. */
	key: string;
}

export interface LLMProtocolAdapter {
	buildPayload(model: string, instructions: string, wire: unknown[], tools: AgentTool[], cache?: CacheHints): Record<string, unknown>;
	parseReply(data: Record<string, unknown>, kind: ProviderKind): AdapterReply;
	toolResults(results: { call: AgentCall; output: unknown }[]): unknown[];
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function parseArguments(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try { return JSON.parse(value); }
	catch { throw new Error('The provider returned invalid tool arguments.'); }
}

const responses: LLMProtocolAdapter = {
	buildPayload(model, instructions, wire, tools, cache) {
		return { model, instructions, input: wire, tools: tools.map((tool) => ({ type: 'function', ...tool, strict: false })), max_output_tokens: 4096, ...(cache ? { prompt_cache_key: cache.key } : {}) };
	},
	parseReply(data) {
		const usage = asRecord(data.usage);
		const input = count(usage.input_tokens);
		const output = Array.isArray(data.output) ? data.output as Record<string, unknown>[] : [];
		const calls = output.filter((item) => item.type === 'function_call').map((item) => ({ id: String(item.call_id), name: String(item.name), arguments: parseArguments(item.arguments) }));
		const text = output.filter((item) => item.type === 'message' && Array.isArray(item.content))
			.flatMap((item) => item.content as Record<string, unknown>[])
			.filter((part) => part.type === 'output_text').map((part) => String(part.text ?? '')).join('');
		return { text, calls, wire: output, usage: { input, output: count(usage.output_tokens), cacheRead: count(asRecord(usage.input_tokens_details).cached_tokens), cacheWrite: 0 } };
	},
	toolResults(results) {
		return results.map(({ call, output }) => ({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(output) }));
	}
};

const messages: LLMProtocolAdapter = {
	// Three cache breakpoints: the tool list and the instructions never change within a run, and the last message moves forward each
	// step so everything said so far is read from the cache instead of being paid for again.
	buildPayload(model, instructions, wire, tools) {
		const ephemeral = { type: 'ephemeral' };
		const defs = tools.map((tool, index) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters, ...(index === tools.length - 1 ? { cache_control: ephemeral } : {}) }));
		const messages = wire.map((entry, index) => {
			if (index !== wire.length - 1) return entry;
			const message = entry as { role: string; content: unknown };
			const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [...(message.content as Record<string, unknown>[])];
			if (blocks.length) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: ephemeral };
			return { ...message, content: blocks };
		});
		return { model, system: [{ type: 'text', text: instructions, cache_control: ephemeral }], messages, tools: defs, max_tokens: 4096 };
	},
	parseReply(data) {
		const usage = asRecord(data.usage);
		const cacheRead = count(usage.cache_read_input_tokens);
		const cacheWrite = count(usage.cache_creation_input_tokens);
		const content = Array.isArray(data.content) ? data.content as Record<string, unknown>[] : [];
		const text = content.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('');
		const calls = content.filter((part) => part.type === 'tool_use').map((part) => ({ id: String(part.id), name: String(part.name), arguments: part.input }));
		// Anthropic reports the uncached part as input_tokens; the totals here count all prompt tokens.
		return { text, calls, wire: [{ role: 'assistant', content }], usage: { input: count(usage.input_tokens) + cacheRead + cacheWrite, output: count(usage.output_tokens), cacheRead, cacheWrite } };
	},
	toolResults(results) {
		return [{ role: 'user', content: results.map(({ call, output }) => ({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) })) }];
	}
};

interface ChatCall { id?: string; function: { name: string; arguments: string | Record<string, unknown> } }

const chat: LLMProtocolAdapter = {
	buildPayload(model, instructions, wire, tools, cache) {
		// Anthropic models behind OpenRouter / AI Gateway take cache breakpoints: one on the instructions (which also covers the tool
		// list before it) and one on the latest message, so each step reads the whole conversation so far from the cache. Other models
		// cache a stable prefix on their own; OpenAI's is steered by the cache key.
		const cached = model.startsWith('anthropic/');
		const ephemeral = { type: 'ephemeral' };
		const system = cached ? { role: 'system', content: [{ type: 'text', text: instructions, cache_control: ephemeral }] } : { role: 'system', content: instructions };
		const messages = cached ? wire.map((entry, index) => {
			const message = entry as { content?: unknown };
			if (index !== wire.length - 1 || typeof message.content !== 'string' || !message.content) return entry;
			return { ...message, content: [{ type: 'text', text: message.content, cache_control: ephemeral }] };
		}) : wire;
		return { model, messages: [system, ...messages], tools: tools.map((tool) => ({ type: 'function', function: tool })), stream: false, ...(cache && model.startsWith('openai/') ? { prompt_cache_key: cache.key } : {}) };
	},
	parseReply(data, kind) {
		const message = (kind === 'ollama' ? data.message : (data.choices as Record<string, unknown>[] | undefined)?.[0]?.message) as Record<string, unknown> | undefined;
		if (!message) throw new Error('The provider returned no message.');
		const text = typeof message.content === 'string' ? message.content : '';
		const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as ChatCall[] : [];
		const calls = rawCalls.map((call, index) => ({ id: call.id ?? `local-${crypto.randomUUID()}-${index}`, name: call.function.name, arguments: parseArguments(call.function.arguments) }));
		const usage = asRecord(data.usage);
		const details = asRecord(usage.prompt_tokens_details);
		const input = kind === 'ollama' ? count(data.prompt_eval_count) : count(usage.prompt_tokens);
		return {
			text, calls,
			wire: [{ role: 'assistant', content: text, ...(rawCalls.length ? { tool_calls: rawCalls.map((call, index) => ({ ...call, id: calls[index].id })) } : {}) }],
			usage: { input, output: kind === 'ollama' ? count(data.eval_count) : count(usage.completion_tokens), cacheRead: count(details.cached_tokens), cacheWrite: count(details.cache_write_tokens) }
		};
	},
	toolResults(results) {
		return results.map(({ call, output }) => ({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(output) }));
	}
};

export const PROTOCOL_ADAPTERS: Record<ProviderProtocol, LLMProtocolAdapter> = { responses, messages, chat };
