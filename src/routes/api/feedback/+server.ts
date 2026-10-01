import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { FEEDBACK_MOODS, parseFeedbackAction } from '$lib/server/feedbackInput';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Sign in to use feedback');
	const [entries, moods] = await Promise.all([
		prisma.feedbackEntry.findMany({ orderBy: [{ votes: 'desc' }, { createdAt: 'asc' }], take: 200 }),
		prisma.feedbackMood.findMany()
	]);
	return json({
		items: entries.map(({ id, title, category, votes, status }) => ({ id, title, category, votes, status, detail: category + ' · ' + status })),
		counts: FEEDBACK_MOODS.map((key) => moods.find((mood) => mood.key === key)?.count ?? 0)
	}, { headers: { 'cache-control': 'no-store' } });
};

/** Identity comes exclusively from the authenticated session. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in to submit feedback');
	const userId = locals.user.id;
	if (Number(request.headers.get('content-length')) > 4096) error(413, 'Feedback request is too large');
	let action;
	try { action = parseFeedbackAction(await request.json()); }
	catch (err) { error(400, err instanceof Error ? err.message : 'Invalid feedback request'); }
	if (action.action === 'suggest') {
		const entry = await prisma.$transaction(async (tx) => {
			const entry = await tx.feedbackEntry.upsert({
				where: { category_titleKey: { category: action.category, titleKey: action.titleKey } },
				create: { category: action.category, title: action.title, titleKey: action.titleKey, userId, status: 'pending', votes: 0 },
				update: {}
			});
			await tx.feedbackInteraction.create({ data: { entryId: entry.id, userId, action: 'suggest', delta: 0 } });
			return entry;
		});
		return json({ entry: { id: entry.id, title: entry.title, category: entry.category, votes: entry.votes, status: entry.status } });
	}
	if (action.action === 'vote') {
		await prisma.$transaction(async (tx) => {
			const result = await tx.feedbackEntry.updateMany({ where: { id: action.id }, data: { votes: { increment: 0 } } });
			if (!result.count) error(404, 'Feedback entry not found');
			// Lock the entry above before reading its vote to serialize concurrent clicks.
			const where = { entryId_userId: { entryId: action.id, userId } };
			const previous = await tx.feedbackVote.findUnique({ where });
			if (previous?.value === action.delta) return;
			const delta = action.delta - (previous?.value ?? 0);
			await tx.feedbackVote.upsert({ where, create: { entryId: action.id, userId, value: action.delta }, update: { value: action.delta } });
			await tx.feedbackEntry.update({ where: { id: action.id }, data: { votes: { increment: delta } } });
			await tx.feedbackInteraction.create({ data: { entryId: action.id, userId, action: 'vote', delta } });
		});
		return json({ ok: true });
	}
	await prisma.$transaction(async (tx) => {
		await tx.feedbackMoodResponse.create({ data: { key: action.key, userId } });
		await tx.feedbackMood.upsert({ where: { key: action.key }, create: { key: action.key, count: 1 }, update: { count: { increment: 1 } } });
	});
	return json({ ok: true });
};
