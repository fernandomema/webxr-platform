import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPurchasedItems } from '$lib/server/services/marketplace';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals }) => {
  try { return json(await listPurchasedItems(locals.user)); } catch (err) { toHttpError(err); }
};
