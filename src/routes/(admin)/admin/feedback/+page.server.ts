import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { FEEDBACK_STATUSES } from '$lib/server/feedbackInput';
import type { Actions, PageServerLoad } from './$types';

const CATEGORIES = ['idea', 'bug', 'other'];
const STATUSES: string[] = [...FEEDBACK_STATUSES];

export const load: PageServerLoad = async ({ url }) => {
	const status = url.searchParams.get('status') ?? '';
	const category = url.searchParams.get('category') ?? '';
	const [entries, counts] = await Promise.all([
		prisma.feedbackEntry.findMany({
			where: { ...(STATUSES.includes(status) ? { status } : {}), ...(CATEGORIES.includes(category) ? { category } : {}) },
			orderBy: [{ votes: 'desc' }, { createdAt: 'desc' }],
			take: 200,
			select: { id: true, title: true, category: true, votes: true, status: true, createdAt: true, user: { select: { name: true } } }
		}),
		prisma.feedbackEntry.groupBy({ by: ['status'], _count: { _all: true } })
	]);
	return {
		status, category, statuses: [...STATUSES], categories: CATEGORIES,
		counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
		entries: entries.map((e) => ({ ...e, author: e.user.name, user: undefined, createdAt: e.createdAt.toISOString() }))
	};
};

export const actions: Actions = {
	setStatus: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const status = String(form.get('status') ?? '');
		if (!id || !STATUSES.includes(status)) return fail(400, { message: 'Invalid feedback status' });
		const result = await prisma.feedbackEntry.updateMany({ where: { id }, data: { status } });
		if (!result.count) return fail(404, { message: 'Feedback entry not found' });
		return { ok: true };
	},
	remove: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		await prisma.feedbackEntry.deleteMany({ where: { id } });
		return { ok: true };
	}
};
