import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteWorldItem, updateWorldItem } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		return json(await updateWorldItem(locals.user, params.id, params.itemId, body.folderId ?? null, body.name, body.slotData));
	} catch (err) {
		toHttpError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		await deleteWorldItem(locals.user, params.id, params.itemId);
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};
