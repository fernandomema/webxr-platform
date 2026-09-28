import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listWorldFolders, createWorldFolder } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ params, url }) => {
	return json(await listWorldFolders(params.id, url.searchParams.get('parentId')));
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		return json(await createWorldFolder(locals.user, params.id, body.parentId ?? null, body.name));
	} catch (err) {
		toHttpError(err);
	}
};
