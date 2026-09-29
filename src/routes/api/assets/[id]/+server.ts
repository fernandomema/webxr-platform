import type { RequestHandler } from './$types';
import { releaseOwnership } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

/** Lets go of the caller's ownership of a model. The file is only removed later, by the cleanup, once nobody owns or uses it. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await releaseOwnership(locals.user, params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
