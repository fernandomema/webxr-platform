import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { sendFriendRequest } from '$lib/server/services/friends';

/** Sends a friend request by `{ username }` or `{ code }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try { return json(await sendFriendRequest(locals.user, await request.json().catch(() => null)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
