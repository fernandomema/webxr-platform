import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { FEEDBACK_STATUSES } from '$lib/server/feedbackInput';

/** Team-only roadmap updates. Public clients cannot mark work as shipped. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'Sign in to manage feedback');
	if (!env.FEEDBACK_ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.FEEDBACK_ADMIN_TOKEN}`) error(403, 'Forbidden');
	let body;
	try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }
	if (!body || !FEEDBACK_STATUSES.includes(body.status)) error(400, 'Invalid feedback status');
	const result = await prisma.feedbackEntry.updateMany({ where: { id: params.id }, data: { status: body.status } });
	if (!result.count) error(404, 'Feedback entry not found');
	return json({ ok: true });
};
