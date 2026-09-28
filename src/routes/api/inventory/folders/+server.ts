import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCloudFolders, createCloudFolder } from '$lib/server/services/cloudInventory';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		return json(await listCloudFolders(locals.user, url.searchParams.get('parentId')));
	} catch (err) {
		toHttpError(err);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		return json(await createCloudFolder(locals.user, body.parentId ?? null, body.name));
	} catch (err) {
		toHttpError(err);
	}
};
