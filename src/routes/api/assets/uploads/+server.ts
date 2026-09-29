import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestUpload } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

/** Step 1: announce a model. Answers `{ exists: true }` when it is already stored (nothing to upload), else where to send the bytes. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await request.json()) as { manifest?: unknown };
		return json(await requestUpload(locals.user, body.manifest));
	} catch (err) {
		toHttpError(err);
	}
};
