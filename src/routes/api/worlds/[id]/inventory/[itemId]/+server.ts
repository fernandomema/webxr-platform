import type { RequestHandler } from './$types';
import { deleteWorldItem } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteWorldItem(locals.user, params.id, params.itemId);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
