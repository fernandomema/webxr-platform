import { prisma } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	const users = await prisma.user.findMany({
		where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }] } : undefined,
		orderBy: { createdAt: 'desc' },
		take: 100,
		select: { id: true, name: true, email: true, username: true, role: true, banned: true, createdAt: true }
	});
	return { q, users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })) };
};
