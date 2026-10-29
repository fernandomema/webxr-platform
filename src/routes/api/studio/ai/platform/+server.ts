import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlatformInfo } from '$lib/server/services/aiPlatform';
import { creditsError } from '$lib/server/creditsApi';

export const GET: RequestHandler = async ({ locals }) => {
	try { return json(await getPlatformInfo(locals.user), { headers: { 'cache-control': 'no-store' } }); } catch (err) { return creditsError(err); }
};
