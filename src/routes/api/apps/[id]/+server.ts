import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteApp, updateApp } from '$lib/server/services/apps';
import { toHttpError } from '$lib/server/apiError';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try { return json({ app: await updateApp(locals.user, params.id, await request.json()) }); }
	catch (err) { toHttpError(err); }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try { await deleteApp(locals.user, params.id); return new Response(null, { status: 204 }); }
	catch (err) { toHttpError(err); }
};
