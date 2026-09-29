import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMarketplaceItem, updateMarketplaceItem } from '$lib/server/services/marketplace';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, params }) => {
  try { return json(await getMarketplaceItem(params.id, locals.user)); } catch (err) { toHttpError(err); }
};
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  try { return json(await updateMarketplaceItem(locals.user, params.id, await request.json())); } catch (err) { toHttpError(err); }
};
