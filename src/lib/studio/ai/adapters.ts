import type { AgentCall, AgentTool, ProviderKind, ProviderProtocol } from './providers';

export interface AdapterReply {
	text: string;
	calls: AgentCall[];
	wire: unknown[];
}

export interface LLMProtocolAdapter {
	buildPayload(model: string, instructions: string, wire: unknown[], tools: AgentTool[]): Record<string, unknown>;
	parseReply(data: Record<string, unknown>, kind: ProviderKind): AdapterReply;
	toolResults(results: { call: AgentCall; output: unknown }[]): unknown[];
}

function parseArguments(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try { return JSON.parse(value); }
	catch { throw new Error('The provider returned invalid tool arguments.'); }
}

const responses: LLMProtocolAdapter = {
	buildPayload(model, instructions, wire, tools) {
		return { model, instructions, input: wire, tools: tools.map((tool) => ({ type: 'function', ...tool, strict: false })), max_output_tokens: 4096 };
	},
	parseReply(data) {
		const output = Array.isArray(data.output) ? data.output as Record<string, unknown>[] : [];
		const calls = output.filter((item) => item.type === 'function_call').map((item) => ({ id: String(item.call_id), name: String(item.name), arguments: parseArguments(item.arguments) }));
		const text = output.filter((item) => item.type === 'message' && Array.isArray(item.content))
			.flatMap((item) => item.content as Record<string, unknown>[])
			.filter((part) => part.type === 'output_text').map((part) => String(part.text ?? '')).join('');
		return { text, calls, wire: output };
	},
	toolResults(results) {
		return results.map(({ call, output }) => ({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(output) }));
	}
};

const messages: LLMProtocolAdapter = {
	buildPayload(model, instructions, wire, tools) {
		return { model, system: instructions, messages: wire, tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), max_tokens: 4096 };
	},
	parseReply(data) {
		const content = Array.isArray(data.content) ? data.content as Record<string, unknown>[] : [];
		const text = content.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('');
		const calls = content.filter((part) => part.type === 'tool_use').map((part) => ({ id: String(part.id), name: String(part.name), arguments: part.input }));
		return { text, calls, wire: [{ role: 'assistant', content }] };
	},
	toolResults(results) {
		return [{ role: 'user', content: results.map(({ call, output }) => ({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) })) }];
	}
};

interface ChatCall { id?: string; function: { name: string; arguments: string | Record<string, unknown> } }

const chat: LLMProtocolAdapter = {
	buildPayload(model, instructions, wire, tools) {
		return { model, messages: [{ role: 'system', content: instructions }, ...wire], tools: tools.map((tool) => ({ type: 'function', function: tool })), stream: false };
	},
	parseReply(data, kind) {
		const message = (kind === 'ollama' ? data.message : (data.choices as Record<string, unknown>[] | undefined)?.[0]?.message) as Record<string, unknown> | undefined;
		if (!message) throw new Error('The provider returned no message.');
		const text = typeof message.content === 'string' ? message.content : '';
		const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls as ChatCall[] : [];
		const calls = rawCalls.map((call, index) => ({ id: call.id ?? `local-${crypto.randomUUID()}-${index}`, name: call.function.name, arguments: parseArguments(call.function.arguments) }));
		return { text, calls, wire: [{ role: 'assistant', content: text, ...(rawCalls.length ? { tool_calls: rawCalls.map((call, index) => ({ ...call, id: calls[index].id })) } : {}) }] };
	},
	toolResults(results) {
		return results.map(({ call, output }) => ({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(output) }));
	}
};

export const PROTOCOL_ADAPTERS: Record<ProviderProtocol, LLMProtocolAdapter> = { responses, messages, chat };
