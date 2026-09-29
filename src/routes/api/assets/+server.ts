import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listMyAssets } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

/** The models the signed-in user owns, and where each is used. */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json(await listMyAssets(locals.user));
	} catch (err) {
		toHttpError(err);
	}
};
