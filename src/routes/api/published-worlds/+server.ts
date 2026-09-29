import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPublications, publishWorld } from '$lib/server/services/publications';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async () => json(await listPublications());

export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const body = await request.json();
    return json(await publishWorld(locals.user, body.name, body.scene), { status: 201 });
  } catch (err) {
    if (err instanceof Error && /Invalid world|World is too large|hierarchy/.test(err.message)) error(400, err.message);
    toHttpError(err);
  }
};
