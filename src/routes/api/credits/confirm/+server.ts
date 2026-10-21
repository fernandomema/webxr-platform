import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmPurchase } from '$lib/server/services/credits';
import { creditsError, readJson } from '$lib/server/creditsApi';

/** Called by the game after the player agreed in the purchase prompt. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try { return json(await confirmPurchase(locals.user, await readJson(request)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { return creditsError(err); }
};
