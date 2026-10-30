import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { syncProviderFriends } from '$lib/server/services/friends';

/** A device that holds a platform's SDK reports `{ proof, friendIds }`; the answer lists platform friends who can be asked to be friends here. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try { return json(await syncProviderFriends(locals.user, params.provider, await request.json().catch(() => null)), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
