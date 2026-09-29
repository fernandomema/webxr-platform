import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMarketplaceItem, listMarketplaceItems } from '$lib/server/services/marketplace';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async () => json(await listMarketplaceItems());
export const POST: RequestHandler = async ({ locals, request }) => {
  try { return json(await createMarketplaceItem(locals.user, await request.json()), { status: 201 }); }
  catch (err) { toHttpError(err); }
};
