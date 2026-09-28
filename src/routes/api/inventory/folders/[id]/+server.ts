import type { RequestHandler } from './$types';
import { deleteCloudFolder } from '$lib/server/services/cloudInventory';
import { toHttpError } from '$lib/server/apiError';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteCloudFolder(locals.user, params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
