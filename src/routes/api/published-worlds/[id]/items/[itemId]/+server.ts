import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteWorldPlayerItem, getWorldPlayerItem, saveWorldPlayerItem } from '$lib/server/services/worldPlayerItems';
import { TooManyRequestsError } from '$lib/server/errors';
import { takeRateToken } from '$lib/server/rateLimit';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		return json(await getWorldPlayerItem(locals.user, params.id, params.itemId));
	} catch (err) {
		toHttpError(err);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		if (locals.user && !takeRateToken(`world-items:${locals.user.id}`, 60)) throw new TooManyRequestsError();
		return json(await saveWorldPlayerItem(locals.user, params.id, await request.json(), params.itemId));
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteWorldPlayerItem(locals.user, params.id, params.itemId);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
