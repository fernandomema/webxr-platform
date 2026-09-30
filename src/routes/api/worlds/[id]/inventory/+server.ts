import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listWorldItems, saveWorldItem } from '$lib/server/services/worldInventory';
import { toHttpError } from '$lib/server/apiError';

/** Host + guests can list (v1 permission model: read-open, write-host-only). */
export const GET: RequestHandler = async ({ params, url }) => {
	return json(await listWorldItems(params.id, url.searchParams.get('folderId')));
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const body = await request.json();
		return json(await saveWorldItem(locals.user, params.id, body.folderId ?? null, body.name, body.slotData, body.kind === 'world' || body.kind === 'avatar' ? body.kind : 'object', body.worldLineageId, body.thumbnailAssetId));
	} catch (err) {
		toHttpError(err);
	}
};
