import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readPublicCloudItem } from '$lib/server/services/cloudInventory';
import { TooManyRequestsError } from '$lib/server/errors';
import { takeRateToken } from '$lib/server/rateLimit';
import { toHttpError } from '$lib/server/apiError';

/** An object that its owner made public (itself or through a folder), readable without signing in. Everything else is a plain 404. */
export const GET: RequestHandler = async ({ locals, params, getClientAddress }) => {
	try {
		if (!takeRateToken(`public-inventory:${locals.user?.id ?? getClientAddress()}`, 240)) throw new TooManyRequestsError();
		// Not cached: the owner can edit or hide it at any time, and the world should follow.
		return json(await readPublicCloudItem(params.id), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		toHttpError(err);
	}
};
