import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { purchaseMarketplaceItem } from '$lib/server/services/marketplace';
import { toHttpError } from '$lib/server/apiError';

export const POST: RequestHandler = async ({ locals, params }) => {
  try { return json(await purchaseMarketplaceItem(locals.user, params.id)); } catch (err) { toHttpError(err); }
};
