import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { issueJoinTicket } from '$lib/server/services/friends';
import { toHttpError } from '$lib/server/apiError';

/** The pass a player shows the signaling server to join a Friends or Friends+ session (`{ ticket: null }` for sessions that need none). */
export const POST: RequestHandler = async ({ locals, params }) => {
	try { return json(await issueJoinTicket(locals.user, params.roomCode), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
