import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLibrary } from '$lib/server/library/registry';
import { limitedBy, respond } from '$lib/server/library/api';

export const GET: RequestHandler = ({ params, locals, getClientAddress, request }) => respond(async () => {
	limitedBy(locals, getClientAddress, 'search', 60);
	return json(await getLibrary().detail(params.ref, request.signal), { headers: { 'cache-control': 'private, max-age=300' } });
});
