import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { toHttpError } from '$lib/server/apiError';
import { blockUser, listBlockedUsers, unblockUser } from '$lib/server/services/friends';

export const GET: RequestHandler = async ({ locals }) => {
	try { return json(await listBlockedUsers(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};

/** Blocks `{ userId }`: ends the friendship and any request between the two. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await blockUser(locals.user, await request.json().catch(() => null));
		return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
	} catch (err) { toHttpError(err); }
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	try {
		await unblockUser(locals.user, await request.json().catch(() => null));
		return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
	} catch (err) { toHttpError(err); }
};
