import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { confirmProviderReceipt } from '$lib/server/services/credits';
import { creditsError, readJson } from '$lib/server/creditsApi';

/** A store receipt held by the player's device (Meta Quest). The provider verifies it before anything is credited. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = (await readJson(request)) as { provider?: unknown; receipt?: unknown } | null;
	try { return json(await confirmProviderReceipt(locals.user, body?.provider, body?.receipt)); } catch (err) { return creditsError(err); }
};
