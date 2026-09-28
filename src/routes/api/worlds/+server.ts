import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listActiveWorldSessions, startHostingSession } from '$lib/server/services/worlds';
import { toHttpError } from '$lib/server/apiError';

/** Public: every currently-hosted session, for the Dash "Worlds" tab. */
export const GET: RequestHandler = async () => {
	return json(await listActiveWorldSessions());
};

/** Hosts the current scene as a brand new world (see /api/worlds/[id]/host to re-host an existing one). */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		const result = await startHostingSession(locals.user, {
			name: body.name,
			sceneSnapshot: body.sceneSnapshot
		});
		return json(result);
	} catch (err) {
		toHttpError(err);
	}
};
