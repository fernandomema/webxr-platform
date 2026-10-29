import type { RequestHandler } from './$types';
import { deleteCloudFolder, updateCloudFolder } from '$lib/server/services/cloudInventory';
import { toHttpError } from '$lib/server/apiError';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		return new Response(JSON.stringify(await updateCloudFolder(locals.user, params.id, await request.json())), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteCloudFolder(locals.user, params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
