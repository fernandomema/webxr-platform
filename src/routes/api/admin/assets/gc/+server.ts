import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { runAssetGc } from '$lib/server/services/assetGc';

/** Model cleanup. Not user-facing: guarded by a shared secret, and absent (404) when none is configured. */
export const POST: RequestHandler = async ({ request, url }) => {
	const token = env.ASSET_ADMIN_TOKEN;
	if (!token) error(404, 'Not found');
	if (request.headers.get('authorization') !== `Bearer ${token}`) error(401, 'Unauthorized');
	return json(await runAssetGc(url.searchParams.get('apply') === '1'));
};
