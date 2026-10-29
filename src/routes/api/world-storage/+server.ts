import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearWorldPlayerItems, worldItemUsage } from '$lib/server/services/worldPlayerItems';
import { toHttpError } from '$lib/server/apiError';

/** What the signed-in account keeps in the cloud for each published world, to see it and to clear it. */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json(await worldItemUsage(locals.user));
	} catch (err) {
		toHttpError(err);
	}
};

/** `?publicationId=` removes everything kept for that world. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
	try {
		const publicationId = url.searchParams.get('publicationId');
		if (!publicationId) return new Response(JSON.stringify({ message: 'publicationId is required' }), { status: 400, headers: { 'content-type': 'application/json' } });
		return json({ removed: await clearWorldPlayerItems(locals.user, publicationId) });
	} catch (err) {
		toHttpError(err);
	}
};
