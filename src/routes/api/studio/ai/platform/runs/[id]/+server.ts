import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { finishRun } from '$lib/server/services/aiPlatform';
import { creditsError, readJson } from '$lib/server/creditsApi';

export const POST: RequestHandler = async ({ locals, request, params }) => {
	try { return json(await finishRun(locals.user, params.id, await readJson(request)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { return creditsError(err); }
};
