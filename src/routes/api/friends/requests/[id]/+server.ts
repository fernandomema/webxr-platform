import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { BadRequestError } from '$lib/server/errors';
import { cancelFriendRequest, respondToFriendRequest } from '$lib/server/services/friends';

/** `{ action: 'accept' | 'decline' }` answers a request the caller received; `{ action: 'cancel' }` withdraws one they sent. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json().catch(() => null);
		const action = (body as { action?: unknown } | null)?.action;
		if (action === 'cancel') {
			await cancelFriendRequest(locals.user, { requestId: params.id });
			return json({ status: 'cancelled' }, { headers: { 'cache-control': 'no-store' } });
		}
		if (action !== 'accept' && action !== 'decline') throw new BadRequestError('Invalid action');
		return json(await respondToFriendRequest(locals.user, { requestId: params.id, action }), { headers: { 'cache-control': 'no-store' } });
	} catch (err) { toHttpError(err); }
};
