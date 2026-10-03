import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolvePublicationContext } from '$lib/server/services/publications';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ params, url }) => {
  try { return json(await resolvePublicationContext(params.id, url.searchParams.get('revision') ?? undefined)); }
  catch (err) { toHttpError(err); }
};
