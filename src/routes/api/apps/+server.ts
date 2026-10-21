import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApp, listApps } from '$lib/server/services/apps';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals }) => {
	try { return json({ apps: await listApps(locals.user) }); }
	catch (err) { toHttpError(err); }
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try { return json({ app: await createApp(locals.user, await request.json()) }, { status: 201 }); }
	catch (err) { toHttpError(err); }
};
