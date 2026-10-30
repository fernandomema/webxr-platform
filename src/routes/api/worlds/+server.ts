import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listActiveWorldSessions, startHostingSession } from '$lib/server/services/worlds';
import { toHttpError } from '$lib/server/apiError';

/** Every public hosted session for the Dash "Worlds" tab, plus the friends-only ones the signed-in caller's friendships reach. */
export const GET: RequestHandler = async ({ locals }) => {
	return json(await listActiveWorldSessions(locals.user), { headers: { 'cache-control': 'no-store' } });
};

/** Hosts the current scene as a brand new world (see /api/worlds/[id]/host to re-host an existing one). */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const result = await startHostingSession(locals.user, {
			name: body.name,
			visibility: body.visibility,
			sceneSnapshot: body.sceneSnapshot,
			publicationId: body.publicationId
		});
		return json(result);
	} catch (err) {
		toHttpError(err);
	}
};
