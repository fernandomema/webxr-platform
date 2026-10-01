import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setWorldPreview } from '$lib/server/services/worlds';
import { toHttpError } from '$lib/server/apiError';

/** The host sends the 360° preview of the world it is hosting (an `image` asset already uploaded to the cloud). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		await setWorldPreview(locals.user, params.id, body.thumbnailAssetId);
		return json({ ok: true });
	} catch (err) {
		toHttpError(err);
	}
};
