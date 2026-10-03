import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readLeaderboard, submitScore } from '$lib/server/services/worldStorage';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  try {
    const limit = url.searchParams.get('limit');
    return json(await readLeaderboard(locals.user, params.id, params.name, limit === null ? undefined : Number(limit)));
  } catch (err) { toHttpError(err); }
};

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  try {
    const body = await request.json();
    return json(await submitScore(locals.user, params.id, params.name, body?.score, body?.order, url.searchParams.get('room') ?? undefined));
  } catch (err) { toHttpError(err); }
};
