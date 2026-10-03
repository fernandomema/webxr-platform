import { PROTOCOL_ADAPTERS } from './adapters';
export type ProviderKind = 'openai' | 'claude' | 'opencode' | 'openrouter' | 'freellmapi' | 'ollama' | 'custom';
export type ProviderProtocol = 'responses' | 'messages' | 'chat';

const PROTOCOL_PATHS: Record<ProviderProtocol, string> = { chat: 'chat/completions', responses: 'responses', messages: 'messages' };

export interface ProviderProfile {
	kind: ProviderKind;
	model: string;
	protocol: ProviderProtocol;
	endpoint: string;
}

export interface AgentTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface AgentCall {
	id: string;
	name: string;
	arguments: unknown;
}

export class FreeLLMAPIConnectionError extends Error {
	constructor() {
		super('Could not connect to FreeLLMAPI. Check that it is running, its CORS settings, and your browser local network permission.');
		this.name = 'FreeLLMAPIConnectionError';
	}
}

export class ProviderConversation {
	private wire: unknown[] = [];
	private readonly sessionId = crypto.randomUUID();

	constructor(readonly profile: ProviderProfile, readonly instructions: string) {}

	addUser(text: string): void {
		this.wire.push({ role: 'user', content: text });
	}

	addResults(results: { call: AgentCall; output: unknown }[]): void {
		this.wire.push(...PROTOCOL_ADAPTERS[this.profile.protocol].toolResults(results));
	}

	async step(credential: string, tools: AgentTool[], signal: AbortSignal, useConnection = false): Promise<{ text: string; calls: AgentCall[] }> {
		if (!this.profile.model.trim()) throw new Error('Choose a model first.');
		const protocol = this.profile.protocol;
		const adapter = PROTOCOL_ADAPTERS[protocol];
		const payload = adapter.buildPayload(this.profile.model, this.instructions, this.wire, tools);

		const kind = this.profile.kind;
		let response: Response;
		if (kind === 'ollama' || kind === 'custom' || kind === 'freellmapi') {
			let endpoint = this.profile.endpoint.trim() || defaultProfile(kind).endpoint;
			const url = new URL(endpoint);
			if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote endpoints must use HTTPS.');
			if (url.username || url.password) throw new Error('Put credentials in the API key field, not in the endpoint URL.');
			if (kind === 'freellmapi') {
				url.pathname = `${url.pathname.replace(/\/+$/, '')}/${PROTOCOL_PATHS[protocol]}`;
				endpoint = url.toString();
			}
			try {
				response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? protocol === 'messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(payload), signal });
			} catch (caught) {
				if (kind !== 'freellmapi' || signal.aborted || !(caught instanceof TypeError)) throw caught;
				throw new FreeLLMAPIConnectionError();
			}
		} else {
			response = await fetch('/api/studio/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-session': this.sessionId }, body: JSON.stringify({ kind, protocol, credential: useConnection ? '' : credential, useConnection, payload }), signal });
		}
		if (!response.ok) {
			const message = await response.text();
			throw new Error(`Provider error ${response.status}: ${message.slice(0, 600)}`);
		}
		const data = await response.json() as Record<string, unknown>;
		const result = adapter.parseReply(data, kind);
		this.wire.push(...result.wire);
		return { text: result.text, calls: result.calls };
	}
}


export function defaultProfile(kind: ProviderKind): ProviderProfile {
	return {
		kind,
		model: kind === 'freellmapi' ? 'auto' : '',
		protocol: kind === 'openai' ? 'responses' : kind === 'claude' ? 'messages' : 'chat',
		endpoint: kind === 'ollama' ? 'http://localhost:11434/api/chat' : kind === 'freellmapi' ? 'http://127.0.0.1:31415/v1' : ''
	};
}
