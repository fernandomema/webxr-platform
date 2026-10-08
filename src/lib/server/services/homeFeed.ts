import { prisma } from '../db';

export interface HomeWorld {
	id: string;
	name: string;
	thumbnailAssetId: string | null;
	/** Shown under the name: players in the last 30 days, a creator, a revision… */
	note?: string;
}

const LIMIT = 10;
const POPULAR_WINDOW_DAYS = 30;

const worldSelect = { id: true, name: true, thumbnailAssetId: true } as const;

/** Records that `userId` just opened a published world. Never throws: a failed visit must not break playing. */
export async function recordWorldVisit(userId: string, publicationId: string): Promise<void> {
	try {
		const now = new Date();
		await prisma.worldVisit.upsert({
			where: { userId_publicationId: { userId, publicationId } },
			create: { userId, publicationId, visitedAt: now },
			update: { visitedAt: now }
		});
	} catch {
		// the publication may have been deleted between the page load and the write
	}
}

export async function recentlyVisited(userId: string): Promise<HomeWorld[]> {
	const visits = await prisma.worldVisit.findMany({
		where: { userId },
		orderBy: { visitedAt: 'desc' },
		take: LIMIT,
		select: { publication: { select: worldSelect } }
	});
	return visits.map((visit) => visit.publication);
}

/** Published worlds ranked by hosted sessions in the last 30 days. */
export async function popularWorlds(): Promise<HomeWorld[]> {
	const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 86_400_000);
	const ranked = await prisma.worldSession.groupBy({
		by: ['publicationId'],
		where: { publicationId: { not: null }, startedAt: { gte: since } },
		_count: { _all: true },
		orderBy: { _count: { publicationId: 'desc' } },
		take: LIMIT
	});
	const ids = ranked.flatMap((row) => (row.publicationId ? [row.publicationId] : []));
	if (ids.length === 0) return [];
	const worlds = await prisma.publishedWorld.findMany({ where: { id: { in: ids } }, select: worldSelect });
	const byId = new Map(worlds.map((world) => [world.id, world]));
	return ranked.flatMap((row) => {
		const world = row.publicationId ? byId.get(row.publicationId) : undefined;
		return world ? [{ ...world, note: `${row._count._all} ${row._count._all === 1 ? 'session' : 'sessions'} this month` }] : [];
	});
}

export async function staffPicks(): Promise<HomeWorld[]> {
	return prisma.publishedWorld.findMany({ where: { staffPick: true }, orderBy: { updatedAt: 'desc' }, take: LIMIT, select: worldSelect });
}

export async function newestWorlds(): Promise<HomeWorld[]> {
	return prisma.publishedWorld.findMany({ orderBy: { createdAt: 'desc' }, take: LIMIT, select: worldSelect });
}
