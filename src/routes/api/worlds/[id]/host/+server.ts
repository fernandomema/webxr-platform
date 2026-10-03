import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startHostingSession, stopHostingSession } from '$lib/server/services/worlds';
import { toHttpError } from '$lib/server/apiError';

/** Re-hosts an existing world (owned by the caller). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		const result = await startHostingSession(locals.user, {
			worldId: params.id,
			visibility: body.visibility,
			sceneSnapshot: body.sceneSnapshot,
			publicationId: body.publicationId
		});
		return json(result);
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await stopHostingSession(locals.user, params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
