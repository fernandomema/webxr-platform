import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPublishedWorld } from '$lib/server/services/publications';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ params, url }) => {
  try { return json(await getPublishedWorld(params.id, url.searchParams.get('revision') ?? undefined)); }
  catch (err) { toHttpError(err); }
};
