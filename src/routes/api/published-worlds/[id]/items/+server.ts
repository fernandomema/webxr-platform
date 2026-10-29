import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listWorldPlayerItems, saveWorldPlayerItem } from '$lib/server/services/worldPlayerItems';
import { TooManyRequestsError } from '$lib/server/errors';
import { takeRateToken } from '$lib/server/rateLimit';
import { toHttpError } from '$lib/server/apiError';

/** The objects the signed-in account keeps in the cloud for this published world (`?key=` finds the one saved under that key). */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		return json(await listWorldPlayerItems(locals.user, params.id, url.searchParams.get('key')));
	} catch (err) {
		toHttpError(err);
	}
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		if (locals.user && !takeRateToken(`world-items:${locals.user.id}`, 60)) throw new TooManyRequestsError();
		return json(await saveWorldPlayerItem(locals.user, params.id, await request.json()));
	} catch (err) {
		toHttpError(err);
	}
};
