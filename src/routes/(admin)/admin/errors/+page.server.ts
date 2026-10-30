import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const LEVELS = ['error', 'warn'];

export const load: PageServerLoad = async ({ url }) => {
	const level = url.searchParams.get('level') ?? '';
	const showResolved = url.searchParams.get('resolved') === '1';
	const where = { ...(LEVELS.includes(level) ? { level } : {}), ...(showResolved ? {} : { resolved: false }) };
	const [entries, open] = await Promise.all([
		prisma.clientError.findMany({ where, orderBy: { lastSeenAt: 'desc' }, take: 200 }),
		prisma.clientError.count({ where: { resolved: false } })
	]);
	return {
		level, showResolved, open,
		entries: entries.map((e) => ({ ...e, firstSeenAt: e.firstSeenAt.toISOString(), lastSeenAt: e.lastSeenAt.toISOString() }))
	};
};

export const actions: Actions = {
	resolve: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const resolved = form.get('resolved') === '1';
		const result = await prisma.clientError.updateMany({ where: { id }, data: { resolved } });
		if (!result.count) return fail(404, { message: 'Error report not found' });
		return { ok: true };
	},
	remove: async ({ request }) => {
		await prisma.clientError.deleteMany({ where: { id: String((await request.formData()).get('id') ?? '') } });
		return { ok: true };
	},
	clearResolved: async () => {
		await prisma.clientError.deleteMany({ where: { resolved: true } });
		return { ok: true };
	}
};
