import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { getMyFriendCode, regenerateFriendCode } from '$lib/server/services/friends';

export const GET: RequestHandler = async ({ locals }) => {
	try { return json(await getMyFriendCode(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};

/** Replaces the caller's friend code. */
export const POST: RequestHandler = async ({ locals }) => {
	try { return json(await regenerateFriendCode(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
