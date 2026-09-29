import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseOpenRouterModels } from '$lib/studio/ai/openrouterModels';

const headers = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async ({ request }) => {
	if (Number(request.headers.get('content-length') ?? 0) > 2048) return json({ message: 'Request is too large.' }, { status: 413, headers });
	if (!request.body) return json({ message: 'Invalid request.' }, { status: 400, headers });
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 2048) {
			await reader.cancel();
			return json({ message: 'Request is too large.' }, { status: 413, headers });
		}
		chunks.push(value);
	}
	let credential: unknown;
	try { credential = JSON.parse(Buffer.concat(chunks).toString('utf8')).credential; }
	catch { return json({ message: 'Invalid request.' }, { status: 400, headers }); }
	if (typeof credential !== 'string' || !credential.trim() || credential.length > 500) {
		return json({ message: 'Enter an OpenRouter API key.' }, { status: 400, headers });
	}
	try {
		const response = await fetch('https://openrouter.ai/api/v1/models?supported_parameters=tools', {
			headers: { authorization: 'Bearer ' + credential },
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
		});
		if (!response.ok) return json({ message: response.status === 401 || response.status === 403 ? 'OpenRouter rejected the API key.' : 'Could not load OpenRouter models.' }, { status: response.status === 401 || response.status === 403 ? 401 : 502, headers });
		const payload = await response.json();
		return json({ models: parseOpenRouterModels(payload) }, { headers });
	} catch {
		return json({ message: 'Could not load OpenRouter models.' }, { status: 502, headers });
	}
};
