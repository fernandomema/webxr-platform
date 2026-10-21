import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPurchaseChallenge } from '$lib/server/services/credits';
import { creditsError, readJson } from '$lib/server/creditsApi';

/** The player's own client asks what something costs. Code blocks cannot reach this route (the sandbox has no network of its own and `ctx.net` refuses it). */
export const POST: RequestHandler = async ({ locals, request }) => {
	try { return json(await createPurchaseChallenge(locals.user, await readJson(request)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { return creditsError(err); }
};
