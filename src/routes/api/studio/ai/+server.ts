import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOpenRouterKey } from '$lib/server/openrouterConnection';

const endpoints: Record<string, Record<string, string>> = {
	openai: { responses: 'https://api.openai.com/v1/responses' },
	claude: { messages: 'https://api.anthropic.com/v1/messages' },
	opencode: {
		responses: 'https://opencode.ai/zen/go/v1/responses',
		messages: 'https://opencode.ai/zen/go/v1/messages',
		chat: 'https://opencode.ai/zen/go/v1/chat/completions'
	},
	openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions' }
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (Number(request.headers.get('content-length') ?? 0) > 500_000) return json({ message: 'Request is too large.' }, { status: 413 });
	if (!request.body) return json({ message: 'Missing request body.' }, { status: 400 });
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 500_000) {
			await reader.cancel();
			return json({ message: 'Request is too large.' }, { status: 413 });
		}
		chunks.push(value);
	}
	let body: Record<string, unknown>;
	try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
	catch { return json({ message: 'Invalid JSON.' }, { status: 400 }); }
	const kind = String(body.kind ?? '');
	const protocol = String(body.protocol ?? '');
	const endpoint = endpoints[kind]?.[protocol];
	let credential = body.credential;
	// The signed-in user's connected OpenRouter account replaces a pasted key; it never reaches the browser.
	if (kind === 'openrouter' && body.useConnection === true) {
		if (!locals.user) return json({ message: 'Sign in to use your OpenRouter connection.' }, { status: 401 });
		credential = (await getOpenRouterKey(locals.user.id)) ?? undefined;
		if (!credential) return json({ message: 'OpenRouter is not connected. Connect it in Settings.' }, { status: 409 });
	}
	if (!endpoint || typeof credential !== 'string' || !credential || credential.length > 500 || !body.payload || typeof body.payload !== 'object') {
		return json({ message: 'Invalid provider configuration.' }, { status: 400 });
	}
	const payload = body.payload as Record<string, unknown>;
	if (typeof payload.model !== 'string' || payload.model.length > 150 || !Array.isArray(payload.tools) || payload.tools.length > 20) {
		return json({ message: 'Invalid model or tools.' }, { status: 400 });
	}
	const serialized = JSON.stringify(payload);
	if (serialized.length > 500_000) return json({ message: 'Request is too large.' }, { status: 413 });
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(protocol === 'messages' ? { 'x-api-key': credential, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${credential}` }),
				...(kind === 'opencode' ? { 'x-opencode-session': String(request.headers.get('x-studio-session') ?? 'studio').slice(0, 100), 'user-agent': 'webxr-studio/1.0' } : {})
			},
			body: serialized,
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
		});
		const answer = await response.text();
		if (answer.length > 2_000_000) return json({ message: 'Provider response is too large.' }, { status: 502 });
		return new Response(answer, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
	} catch {
		return json({ message: 'Could not reach the provider.' }, { status: 502, headers: { 'cache-control': 'no-store' } });
	}
};
