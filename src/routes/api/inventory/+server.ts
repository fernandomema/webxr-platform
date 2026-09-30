import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCloudItems, saveCloudItem } from '$lib/server/services/cloudInventory';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		return json(await listCloudItems(locals.user, url.searchParams.get('folderId')));
	} catch (err) {
		toHttpError(err);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = await request.json();
		return json(await saveCloudItem(locals.user, body.folderId ?? null, body.name, body.slotData, body.kind === 'world' || body.kind === 'avatar' ? body.kind : 'object', body.worldLineageId));
	} catch (err) {
		toHttpError(err);
	}
};
