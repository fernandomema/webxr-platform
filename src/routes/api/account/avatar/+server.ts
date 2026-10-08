import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setProfileAvatar } from '$lib/server/services/profileAvatar';
import { toHttpError } from '$lib/server/apiError';

export const PUT: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await request.json().catch(() => ({}))) as { assetId?: unknown };
		return json(await setProfileAvatar(locals.user, body.assetId ?? null));
	} catch (err) {
		toHttpError(err);
	}
};
