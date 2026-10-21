import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEntitlements } from '$lib/server/services/credits';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, url }) => {
	try { return json(await listEntitlements(locals.user, url.searchParams.get('publicationId')), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
