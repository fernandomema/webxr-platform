import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3Prompt, LanguageModelV3StreamPart, LanguageModelV3ToolCallPart, LanguageModelV3ToolResultPart, LanguageModelV3Usage } from '@ai-sdk/provider';
import { generateOnce, type AgentTool, type ProviderProfile } from './providers';

/** The platform run this conversation's steps belong to; the server needs it on every call while it is open. */
export interface KithinModelContext {
	runId: string | null;
}

const jsonOf = (value: unknown): string => {
	try { return JSON.stringify(value) ?? 'null'; } catch { return String(value); }
};

/** Maps the AI SDK's normalized prompt to the wire format our protocol adapters build on (one shape per protocol). Tool results are emitted right after the assistant message that asked for them: providers require that order. */
function toWire(prompt: LanguageModelV3Prompt, protocol: ProviderProfile['protocol']): { instructions: string; wire: unknown[] } {
	let instructions = '';
	const wire: unknown[] = [];
	const pushResults = (results: LanguageModelV3ToolResultPart[]) => {
		if (!results.length) return;
		if (protocol === 'messages') {
			wire.push({ role: 'user', content: results.map((part) => ({ type: 'tool_result', tool_use_id: part.toolCallId, content: jsonOf(part.output) })) });
		} else if (protocol === 'responses') {
			wire.push(...results.map((part) => ({ type: 'function_call_output', call_id: part.toolCallId, output: jsonOf(part.output) })));
		} else {
			wire.push(...results.map((part) => ({ role: 'tool', tool_call_id: part.toolCallId, name: part.toolName, content: jsonOf(part.output) })));
		}
	};
	for (const message of prompt) {
		if (message.role === 'system') {
			instructions = message.content;
			continue;
		}
		if (message.role === 'tool') {
			pushResults(message.content.filter((part): part is LanguageModelV3ToolResultPart => part.type === 'tool-result'));
			continue;
		}
		if (message.role === 'user') {
			const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
			if (text.trim()) wire.push({ role: 'user', content: text });
			continue;
		}
		// assistant
		const calls = message.content.filter((part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call');
		const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
		if (protocol === 'messages') {
			wire.push({ role: 'assistant', content: [...(text ? [{ type: 'text', text }] : []), ...calls.map((call) => ({ type: 'tool_use', id: call.toolCallId, name: call.toolName, input: call.input }))] });
		} else if (protocol === 'responses') {
			wire.push({ role: 'assistant', output: [...calls.map((call) => ({ type: 'function_call', call_id: call.toolCallId, name: call.toolName, arguments: jsonOf(call.input) })), ...(text ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] : [])] });
		} else {
			wire.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls.map((call) => ({ id: call.toolCallId, type: 'function', function: { name: call.toolName, arguments: jsonOf(call.input) } })) } : {}) });
		}
	}
	return { instructions, wire };
}

const toUsage = (usage: { input: number; output: number; cacheRead: number; cacheWrite: number }): LanguageModelV3Usage => ({
	inputTokens: { total: usage.input, noCache: Math.max(0, usage.input - usage.cacheRead - usage.cacheWrite), cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
	outputTokens: { total: usage.output, text: usage.output, reasoning: 0 }
});

/**
 * A Vercel AI SDK language model backed by Kithin's own provider plumbing (`generateOnce`): the same adapters, server
 * proxy, platform runs, cache hints and billing as the hand-rolled loop. The SDK drives the agent loop; this adapter only
 * translates between the SDK's normalized prompt and our per-protocol wire format.
 */
export function createKithinModel(profile: ProviderProfile, credential: string, useConnection: boolean, context: KithinModelContext): LanguageModelV3 {
	const sessionId = crypto.randomUUID();
	return {
		specificationVersion: 'v3',
		provider: 'kithin',
		modelId: profile.model,
		supportedUrls: {},
		async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
			const { instructions, wire } = toWire(options.prompt, profile.protocol);
			const tools: AgentTool[] = (options.tools ?? [])
				.filter((tool) => tool.type === 'function')
				.map((tool) => ({ name: tool.name, description: tool.description ?? '', parameters: tool.inputSchema as Record<string, unknown> }));
			const reply = await generateOnce(profile, instructions, wire, tools, credential, sessionId, options.abortSignal ?? AbortSignal.timeout(120_000), useConnection, context.runId);
			const content: LanguageModelV3GenerateResult['content'] = [
				...(reply.text ? [{ type: 'text' as const, text: reply.text }] : []),
				...reply.calls.map((call) => ({ type: 'tool-call' as const, toolCallId: call.id, toolName: call.name, input: jsonOf(call.arguments) }))
			];
			return { content, finishReason: { unified: reply.calls.length ? 'tool-calls' : 'stop', raw: undefined }, usage: toUsage(reply.usage), warnings: [] };
		},
		async doStream(options: LanguageModelV3CallOptions) {
			const result = await this.doGenerate(options);
			const parts: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }];
			for (const item of result.content) {
				if (item.type === 'text') {
					parts.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: item.text }, { type: 'text-end', id: 'text' });
				} else if (item.type === 'tool-call') {
					parts.push({ type: 'tool-input-start', id: item.toolCallId, toolName: item.toolName }, { type: 'tool-input-delta', id: item.toolCallId, delta: item.input }, { type: 'tool-input-end', id: item.toolCallId }, item);
				}
			}
			parts.push({ type: 'finish', usage: result.usage, finishReason: result.finishReason });
			return { stream: new ReadableStream<LanguageModelV3StreamPart>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } }) };
		}
	};
}
