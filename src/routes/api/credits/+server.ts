import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCreditsSummary } from '$lib/server/services/credits';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals }) => {
	try { return json(await getCreditsSummary(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { toHttpError(err); }
};
