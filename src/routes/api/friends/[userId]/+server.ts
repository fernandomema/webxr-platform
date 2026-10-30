import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { removeFriend } from '$lib/server/services/friends';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await removeFriend(locals.user, { userId: params.userId });
		return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
	} catch (err) { toHttpError(err); }
};
