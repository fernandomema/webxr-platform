import { prisma } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
	const [users, newUsers, worlds, publicWorlds, published, assets] = await Promise.all([
		prisma.user.count(),
		prisma.user.count({ where: { createdAt: { gte: since } } }),
		prisma.world.count(),
		prisma.world.count({ where: { visibility: 'public' } }),
		prisma.publishedWorld.count(),
		prisma.asset.count()
	]);
	return { stats: { users, newUsers, worlds, publicWorlds, published, assets } };
};
