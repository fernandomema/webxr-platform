import type { RequestHandler } from './$types';
import { deleteWorldFolder } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteWorldFolder(locals.user, params.id, params.folderId);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
