import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startRun } from '$lib/server/services/aiPlatform';
import { creditsError, readJson } from '$lib/server/creditsApi';

export const POST: RequestHandler = async ({ locals, request }) => {
	try { return json(await startRun(locals.user, await readJson(request)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { return creditsError(err); }
};
