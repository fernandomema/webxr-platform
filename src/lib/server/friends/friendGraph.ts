import { prisma } from '../db';

/** Ids of the confirmed friends of `userId`. */
export async function friendIdsOf(userId: string): Promise<string[]> {
	const rows = await prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { userAId: true, userBId: true } });
	return rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));
}

/** Everyone who blocked `userId` or was blocked by them: neither side sees the other. */
export async function blockedBetween(userId: string): Promise<Set<string>> {
	const rows = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
	return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
}

/** Hosts whose sessions `viewerId` may see beyond public ones: friends, and for Friends+ also friends of friends. */
export async function reachableHosts(viewerId: string): Promise<{ friends: Set<string>; friendsPlus: Set<string> }> {
	const [direct, blocked] = await Promise.all([friendIdsOf(viewerId), blockedBetween(viewerId)]);
	const friends = new Set(direct);
	const plus = new Set(direct);
	if (direct.length > 0) {
		const rows = await prisma.friendship.findMany({ where: { OR: [{ userAId: { in: direct } }, { userBId: { in: direct } }] }, select: { userAId: true, userBId: true } });
		for (const row of rows) { plus.add(row.userAId); plus.add(row.userBId); }
	}
	plus.delete(viewerId);
	for (const id of blocked) { friends.delete(id); plus.delete(id); }
	return { friends, friendsPlus: plus };
}
