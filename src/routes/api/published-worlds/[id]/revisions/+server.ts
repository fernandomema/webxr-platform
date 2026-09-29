import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { publishRevision } from '$lib/server/services/publications';
import { toHttpError } from '$lib/server/apiError';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  try {
    const body = await request.json();
    return json(await publishRevision(locals.user, params.id, body.scene), { status: 201 });
  } catch (err) {
    if (err instanceof Error && /Invalid world|World is too large|hierarchy/.test(err.message)) error(400, err.message);
    toHttpError(err);
  }
};
