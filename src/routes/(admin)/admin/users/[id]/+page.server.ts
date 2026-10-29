import { error, fail } from '@sveltejs/kit';
import { prisma } from '$lib/server/db';
import { applyAdjustment, type LedgerTx } from '$lib/server/services/creditLedger';
import { measureRunCosts } from '$lib/server/services/aiPlatform';
import type { PageServerLoad, Actions } from './$types';

const asIso = (value: Date | null | undefined) => value ? value.toISOString() : null;

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = await prisma.user.findUnique({
		where: { id: params.id },
		select: { id: true, name: true, email: true, emailVerified: true, username: true, displayUsername: true, role: true, banned: true, banReason: true, banExpires: true, createdAt: true, updatedAt: true }
	});
	if (!user) error(404, 'User not found');
	const [creditAccount, transactions, aiStats, aiModels, recentRuns, worlds, worldCount, publications, publicationCount, inventoryCount, assetCount] = await Promise.all([
		prisma.creditAccount.findUnique({ where: { userId: user.id } }),
		prisma.creditTransaction.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
		prisma.aiRun.aggregate({ where: { userId: user.id }, _count: true, _sum: { inputTokens: true, outputTokens: true, credits: true } }),
		prisma.aiRun.groupBy({ by: ['model'], where: { userId: user.id, status: 'completed' }, _count: true, _sum: { credits: true }, orderBy: { _count: { model: 'desc' } }, take: 5 }),
		prisma.aiRun.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, model: true, status: true, free: true, credits: true, refunded: true, calls: true, steps: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, createdAt: true } }),
		prisma.world.findMany({ where: { hostUserId: user.id }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, name: true, visibility: true, updatedAt: true } }),
		prisma.world.count({ where: { hostUserId: user.id } }),
		prisma.publishedWorld.findMany({ where: { ownerId: user.id }, orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, name: true, kind: true, staffPick: true, updatedAt: true } }),
		prisma.publishedWorld.count({ where: { ownerId: user.id } }),
		prisma.cloudInventoryItem.count({ where: { ownerId: user.id } }),
		prisma.assetOwner.count({ where: { ownerId: user.id } })
	]);
	const realCosts = await measureRunCosts(recentRuns);
	return {
		self: locals.user?.id === user.id,
		user: { ...user, banExpires: asIso(user.banExpires), createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() },
		credits: { balance: creditAccount?.balance ?? 0, transactions: transactions.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })) },
		ai: {
			runs: aiStats._count,
			inputTokens: aiStats._sum.inputTokens ?? 0,
			outputTokens: aiStats._sum.outputTokens ?? 0,
			credits: aiStats._sum.credits ?? 0,
			models: aiModels.map((m) => ({ model: m.model, runs: m._count, credits: m._sum.credits ?? 0 })),
			recent: recentRuns.map((r) => ({ ...r, costCredits: realCosts.get(r.id) ?? null, createdAt: r.createdAt.toISOString() }))
		},
		content: {
			worlds: worlds.map((w) => ({ ...w, updatedAt: w.updatedAt.toISOString() })),
			worldCount,
			publications: publications.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
			publicationCount,
			inventoryCount,
			assetCount
		}
	};
};

export const actions: Actions = {
	updateUser: async ({ params, request, locals }) => {
		const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, role: true, banned: true } });
		if (!target) return fail(404, { message: 'User not found' });
		const form = await request.formData();
		const self = locals.user?.id === target.id;
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const username = String(form.get('username') ?? '').trim() || null;
		const emailVerified = form.get('emailVerified') === 'on';
		const banned = form.get('banned') === 'on';
		const banReason = String(form.get('banReason') ?? '').trim() || null;
		const banExpiresRaw = String(form.get('banExpires') ?? '');
		const banExpires = banExpiresRaw ? new Date(banExpiresRaw) : null;
		if (!name || !email) return fail(400, { message: 'Name and email are required.' });
		if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, { message: 'Invalid email address.' });
		if (banExpires && Number.isNaN(banExpires.getTime())) return fail(400, { message: 'Invalid ban expiry date.' });
		// An admin cannot demote or ban themselves: that would lock the platform's last operator out.
		const role = self ? target.role : String(form.get('role') ?? '').trim() || null;
		const bannedSafe = self ? Boolean(target.banned) : banned;
		try {
			await prisma.user.update({ where: { id: target.id }, data: { name, email, username, emailVerified, role, banned: bannedSafe, banReason: bannedSafe ? banReason : null, banExpires: bannedSafe ? banExpires : null } });
		} catch (err) {
			return fail(400, { message: err instanceof Error && err.message.includes('Unique constraint') ? 'That email or username is taken.' : 'Could not save the user.' });
		}
		return { saved: true };
	},
	adjustCredits: async ({ params, request, locals }) => {
		const form = await request.formData();
		const amount = Number(String(form.get('amount') ?? ''));
		const note = String(form.get('note') ?? '').trim();
		if (!Number.isInteger(amount) || amount === 0) return fail(400, { message: 'Enter a non-zero whole number of credits.' });
		if (Math.abs(amount) > 100_000) return fail(400, { message: 'A single adjustment is limited to 100,000 credits.' });
		if (!note) return fail(400, { message: 'A note explaining the adjustment is required.' });
		try {
			await prisma.$transaction((tx) => applyAdjustment(tx as unknown as LedgerTx, {
				userId: params.id,
				amount,
				note: `${locals.user?.email ?? 'admin'}: ${note}`.slice(0, 190),
				idempotencyKey: `admin-adjust:${crypto.randomUUID()}`
			}));
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Could not adjust the balance.' });
		}
		return { saved: true };
	}
};
