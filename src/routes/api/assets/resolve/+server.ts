import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveAssets } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

/**
 * Where to download models from. Open to signed-out players too, but only for
 * models a published or hosted world uses (or the caller owns).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await request.json()) as { ids?: unknown };
		return json({ assets: await resolveAssets(locals.user, body.ids) });
	} catch (err) {
		toHttpError(err);
	}
};
