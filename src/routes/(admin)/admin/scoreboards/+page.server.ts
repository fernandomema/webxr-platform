import { fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const selected = url.searchParams.get('board') ?? '';
	const boards = await prisma.leaderboard.findMany({
		orderBy: { createdAt: 'desc' },
		take: 200,
		select: {
			id: true, name: true, order: true, seasonId: true, createdAt: true,
			publication: { select: { id: true, name: true } },
			_count: { select: { entries: true } }
		}
	});
	const board = boards.find((b) => b.id === selected) ?? null;
	const entries = board
		? await prisma.leaderboardEntry.findMany({
			where: { leaderboardId: board.id },
			orderBy: { score: board.order === 'high' ? 'desc' : 'asc' },
			take: 200,
			select: { accountId: true, displayName: true, score: true, updatedAt: true, account: { select: { email: true } } }
		})
		: [];
	return {
		selected: board?.id ?? '',
		boards: boards.map((b) => ({
			id: b.id, name: b.name, order: b.order, seasonId: b.seasonId, world: b.publication.name, worldId: b.publication.id,
			entryCount: b._count.entries, createdAt: b.createdAt.toISOString()
		})),
		entries: entries.map((e, i) => ({ rank: i + 1, accountId: e.accountId, displayName: e.displayName, email: e.account.email, score: e.score, updatedAt: e.updatedAt.toISOString() }))
	};
};

export const actions: Actions = {
	removeEntry: async ({ request }) => {
		const form = await request.formData();
		const leaderboardId = String(form.get('board') ?? '');
		const accountId = String(form.get('account') ?? '');
		if (!leaderboardId || !accountId) return fail(400, { message: 'Missing board or account' });
		await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId, accountId } });
		return { ok: true };
	},
	clearBoard: async ({ request }) => {
		const leaderboardId = String((await request.formData()).get('board') ?? '');
		if (!leaderboardId) return fail(400, { message: 'Missing board' });
		await prisma.leaderboardEntry.deleteMany({ where: { leaderboardId } });
		return { ok: true };
	},
	removeBoard: async ({ request }) => {
		const id = String((await request.formData()).get('board') ?? '');
		if (!id) return fail(400, { message: 'Missing board' });
		await prisma.leaderboard.deleteMany({ where: { id } });
		return { ok: true };
	}
};
