import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assetUsage } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json(await assetUsage(locals.user));
	} catch (err) {
		toHttpError(err);
	}
};
