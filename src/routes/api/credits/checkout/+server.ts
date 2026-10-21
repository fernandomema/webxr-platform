import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startCheckout } from '$lib/server/services/credits';
import { creditsError, readJson } from '$lib/server/creditsApi';

export const POST: RequestHandler = async ({ locals, request, url }) => {
	try { return json(await startCheckout(locals.user, await readJson(request), url.origin)); } catch (err) { return creditsError(err); }
};
