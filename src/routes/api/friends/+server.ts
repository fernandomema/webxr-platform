import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { getFriendsOverview } from '$lib/server/services/friends';

/** The caller's friends (with the session each is hosting), and the requests waiting in both directions. */
export const GET: RequestHandler = async ({ locals }) => {
	try { return json(await getFriendsOverview(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
