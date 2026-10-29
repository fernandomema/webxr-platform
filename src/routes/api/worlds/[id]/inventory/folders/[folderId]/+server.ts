import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { deleteWorldFolder, updateWorldFolder } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		return json(await updateWorldFolder(locals.user, params.id, params.folderId, await request.json()));
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteWorldFolder(locals.user, params.id, params.folderId);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
