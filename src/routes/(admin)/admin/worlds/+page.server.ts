import { prisma } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const worlds = await prisma.world.findMany({
		orderBy: { createdAt: 'desc' },
		take: 100,
		select: { id: true, name: true, visibility: true, createdAt: true, hostUser: { select: { name: true, email: true } } }
	});
	return { worlds: worlds.map((w) => ({ ...w, createdAt: w.createdAt.toISOString() })) };
};
