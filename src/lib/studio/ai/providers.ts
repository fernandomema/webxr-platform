import { PROTOCOL_ADAPTERS } from './adapters';
export type ProviderKind = 'openai' | 'claude' | 'opencode' | 'openrouter' | 'ollama' | 'custom';
export type ProviderProtocol = 'responses' | 'messages' | 'chat';

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

	async step(credential: string, tools: AgentTool[], signal: AbortSignal): Promise<{ text: string; calls: AgentCall[] }> {
		if (!this.profile.model.trim()) throw new Error('Choose a model first.');
		const protocol = this.profile.protocol;
		const adapter = PROTOCOL_ADAPTERS[protocol];
		const payload = adapter.buildPayload(this.profile.model, this.instructions, this.wire, tools);

		const kind = this.profile.kind;
		let response: Response;
		if (kind === 'ollama' || kind === 'custom') {
			const endpoint = this.profile.endpoint.trim() || (kind === 'ollama' ? 'http://localhost:11434/api/chat' : '');
			const url = new URL(endpoint);
			if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote custom endpoints must use HTTPS.');
			if (url.username || url.password) throw new Error('Put credentials in the API key field, not in the endpoint URL.');
			response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? protocol === 'messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(payload), signal });
		} else {
			response = await fetch('/api/studio/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-session': this.sessionId }, body: JSON.stringify({ kind, protocol, credential, payload }), signal });
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
		model: '',
		protocol: kind === 'openai' ? 'responses' : kind === 'claude' ? 'messages' : 'chat',
		endpoint: kind === 'ollama' ? 'http://localhost:11434/api/chat' : ''
	};
}
