import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runStorage } from '$lib/server/services/worldStorage';
import { toHttpError } from '$lib/server/apiError';

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  try { return json(await runStorage(locals.user, params.id, await request.json(), url.searchParams.get('room') ?? undefined)); }
  catch (err) { toHttpError(err); }
};
