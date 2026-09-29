import type { RequestHandler } from './$types';
import { deleteCloudItem, updateCloudItem } from '$lib/server/services/cloudInventory';
import { toHttpError } from '$lib/server/apiError';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		return new Response(JSON.stringify(await updateCloudItem(locals.user, params.id, body.folderId ?? null, body.name, body.slotData)), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteCloudItem(locals.user, params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
