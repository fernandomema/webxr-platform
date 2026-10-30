import { randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../errors';
import { env } from '$env/dynamic/private';
import { reachableHosts } from '../friends/friendGraph';
import { getFriendProvider } from '../friends/providers';
import { JOIN_TICKET_TTL_MS, signJoinTicket } from '../joinTicket';
import { takeRateToken } from '../rateLimit';
import type { SessionUser } from './worlds';

const MAX_FRIENDS = 500;
const MAX_OPEN_REQUESTS = 50;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const person = { id: true, name: true, username: true, displayUsername: true, image: true } as const;

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
const asObject = (input: unknown): Record<string, unknown> => {
	if (typeof input !== 'object' || input === null) throw new BadRequestError('Invalid request');
	return input as Record<string, unknown>;
};
const asId = (value: unknown): string => {
	if (typeof value !== 'string' || !value || value.length > 64) throw new BadRequestError('Invalid id');
	return value;
};
/** The two ids in the order a `friendship` row stores them. */
const pair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

function newFriendCode(): string {
	const bytes = randomBytes(CODE_LENGTH);
	return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

/** What a person types: any case, with or without separators ("abcd-efgh"). */
function normalizeFriendCode(value: unknown): string {
	if (typeof value !== 'string') throw new BadRequestError('Invalid friend code');
	const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (code.length !== CODE_LENGTH) throw new BadRequestError('Invalid friend code');
	return code;
}

function publicPerson(row: { id: string; name: string; username: string | null; displayUsername: string | null; image: string | null }) {
	return { id: row.id, name: row.name, username: row.displayUsername ?? row.username, image: row.image };
}

/** Presence is the session a friend is hosting right now, when its visibility lets a friend in. */
async function hostedSessions(hostIds: string[]) {
	if (hostIds.length === 0) return new Map<string, { roomCode: string; worldName: string; visibility: string }>();
	const sessions = await prisma.worldSession.findMany({
		where: { endedAt: null, hostUserId: { in: hostIds }, world: { visibility: { in: ['public', 'friends', 'friends-plus'] } } },
		select: { roomCode: true, hostUserId: true, world: { select: { name: true, visibility: true } } },
		orderBy: { startedAt: 'desc' }
	});
	const byHost = new Map<string, { roomCode: string; worldName: string; visibility: string }>();
	for (const session of sessions) if (!byHost.has(session.hostUserId)) byHost.set(session.hostUserId, { roomCode: session.roomCode, worldName: session.world.name, visibility: session.world.visibility });
	return byHost;
}

/** The friend list, the open requests in both directions and where each friend is playing: everything the friends screens poll for. */
export async function getFriendsOverview(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const [friendships, incoming, outgoing] = await Promise.all([
		prisma.friendship.findMany({
			where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
			select: { userAId: true, userA: { select: person }, userB: { select: person } }
		}),
		prisma.friendRequest.findMany({ where: { toUserId: user.id }, select: { id: true, createdAt: true, from: { select: person } }, orderBy: { createdAt: 'desc' } }),
		prisma.friendRequest.findMany({ where: { fromUserId: user.id }, select: { id: true, createdAt: true, to: { select: person } }, orderBy: { createdAt: 'desc' } })
	]);
	const friends = friendships.map((row) => (row.userAId === user.id ? row.userB : row.userA));
	const sessions = await hostedSessions(friends.map((friend) => friend.id));
	return {
		friends: friends
			.map((friend) => ({ ...publicPerson(friend), session: sessions.get(friend.id) ?? null }))
			.sort((a, b) => Number(Boolean(b.session)) - Number(Boolean(a.session)) || a.name.localeCompare(b.name)),
		incoming: incoming.map((row) => ({ id: row.id, createdAt: row.createdAt, from: publicPerson(row.from) })),
		outgoing: outgoing.map((row) => ({ id: row.id, createdAt: row.createdAt, to: publicPerson(row.to) }))
	};
}

async function countFriends(userId: string): Promise<number> {
	return prisma.friendship.count({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
}

/** Makes `a` and `b` friends and closes any request between them. */
async function befriend(a: string, b: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.friendRequest.deleteMany({ where: { OR: [{ fromUserId: a, toUserId: b }, { fromUserId: b, toUserId: a }] } });
		try {
			await tx.friendship.create({ data: pair(a, b) });
		} catch (err) {
			if (!isUniqueViolation(err)) throw err;
		}
	});
}

/**
 * Asks someone to be friends, by the username they chose or by their friend code. If they already asked the caller, the two
 * requests meet and become a friendship. Anyone who is missing, banned or has blocked the caller looks the same: not found.
 */
export async function sendFriendRequest(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const body = asObject(input);
	if (!takeRateToken(`friend-request:${user.id}`, 20, 3_600_000)) throw new TooManyRequestsError();

	let target: { id: string; banned: boolean | null } | null;
	if (typeof body.code === 'string') target = await prisma.user.findFirst({ where: { friendCode: normalizeFriendCode(body.code) }, select: { id: true, banned: true } });
	else if (typeof body.username === 'string' && body.username.trim() && body.username.length <= 64) target = await prisma.user.findUnique({ where: { username: body.username.trim().toLowerCase().replace(/^@/, '') }, select: { id: true, banned: true } });
	else throw new BadRequestError('Give a username or a friend code');
	if (!target || target.banned) throw new NotFoundError();
	if (target.id === user.id) throw new BadRequestError('You cannot add yourself');

	const blocks = await prisma.userBlock.findMany({ where: { OR: [{ blockerId: user.id, blockedId: target.id }, { blockerId: target.id, blockedId: user.id }] }, select: { blockerId: true } });
	const targetId = target.id;
	if (blocks.some((block) => block.blockerId === targetId)) throw new NotFoundError();
	if (blocks.length > 0) throw new ConflictError('Unblock this person first');

	const keys = pair(user.id, target.id);
	if (await prisma.friendship.findUnique({ where: { userAId_userBId: keys }, select: { userAId: true } })) throw new ConflictError('You are already friends');
	if (await prisma.friendRequest.findUnique({ where: { fromUserId_toUserId: { fromUserId: target.id, toUserId: user.id } }, select: { id: true } })) {
		if (await countFriends(user.id) >= MAX_FRIENDS) throw new ConflictError('Your friend list is full');
		await befriend(user.id, target.id);
		return { status: 'friends' as const };
	}
	if (await prisma.friendRequest.findUnique({ where: { fromUserId_toUserId: { fromUserId: user.id, toUserId: target.id } }, select: { id: true } })) return { status: 'pending' as const };
	if (await prisma.friendRequest.count({ where: { fromUserId: user.id } }) >= MAX_OPEN_REQUESTS) throw new ConflictError('Too many pending requests');
	if (await countFriends(user.id) >= MAX_FRIENDS) throw new ConflictError('Your friend list is full');
	try {
		await prisma.friendRequest.create({ data: { fromUserId: user.id, toUserId: target.id } });
	} catch (err) {
		if (!isUniqueViolation(err)) throw err;
	}
	return { status: 'pending' as const };
}

/** Accepts or declines a request the caller received. */
export async function respondToFriendRequest(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const body = asObject(input);
	const requestId = asId(body.requestId);
	if (body.action !== 'accept' && body.action !== 'decline') throw new BadRequestError('Invalid action');
	const request = await prisma.friendRequest.findFirst({ where: { id: requestId, toUserId: user.id }, select: { id: true, fromUserId: true } });
	if (!request) throw new NotFoundError();
	if (body.action === 'decline') {
		await prisma.friendRequest.deleteMany({ where: { id: request.id } });
		return { status: 'declined' as const };
	}
	if (await countFriends(user.id) >= MAX_FRIENDS) throw new ConflictError('Your friend list is full');
	await befriend(user.id, request.fromUserId);
	return { status: 'friends' as const };
}

/** Withdraws a request the caller sent. */
export async function cancelFriendRequest(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const requestId = asId(asObject(input).requestId);
	const { count } = await prisma.friendRequest.deleteMany({ where: { id: requestId, fromUserId: user.id } });
	if (count === 0) throw new NotFoundError();
}

export async function removeFriend(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const friendId = asId(asObject(input).userId);
	const { count } = await prisma.friendship.deleteMany({ where: pair(user.id, friendId) });
	if (count === 0) throw new NotFoundError();
}

/** Blocks a person: ends the friendship and any request between the two, and keeps them from asking again. */
export async function blockUser(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const targetId = asId(asObject(input).userId);
	if (targetId === user.id) throw new BadRequestError('You cannot block yourself');
	if (!await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })) throw new NotFoundError();
	await prisma.$transaction(async (tx) => {
		await tx.friendship.deleteMany({ where: pair(user.id, targetId) });
		await tx.friendRequest.deleteMany({ where: { OR: [{ fromUserId: user.id, toUserId: targetId }, { fromUserId: targetId, toUserId: user.id }] } });
		await tx.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetId } }, create: { blockerId: user.id, blockedId: targetId }, update: {} });
	});
}

export async function unblockUser(user: SessionUser | null, input: unknown) {
	if (!user) throw new UnauthorizedError();
	await prisma.userBlock.deleteMany({ where: { blockerId: user.id, blockedId: asId(asObject(input).userId) } });
}

export async function listBlockedUsers(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const rows = await prisma.userBlock.findMany({ where: { blockerId: user.id }, select: { blocked: { select: person } }, orderBy: { createdAt: 'desc' } });
	return rows.map((row) => publicPerson(row.blocked));
}

async function assignFriendCode(userId: string, replace: boolean): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = newFriendCode();
		// The column is not unique in the database (yet), so a taken code is looked for here.
		if (await prisma.user.findFirst({ where: { friendCode: code }, select: { id: true } })) continue;
		try {
			const { count } = await prisma.user.updateMany({ where: replace ? { id: userId } : { id: userId, friendCode: null }, data: { friendCode: code } });
			if (count > 0) return code;
			const current = await prisma.user.findUnique({ where: { id: userId }, select: { friendCode: true } });
			if (current?.friendCode) return current.friendCode;
		} catch (err) {
			if (!isUniqueViolation(err)) throw err;
		}
	}
	throw new Error('Could not create a friend code');
}

/** The caller's friend code, created the first time it is asked for. */
export async function getMyFriendCode(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const row = await prisma.user.findUnique({ where: { id: user.id }, select: { friendCode: true } });
	return { code: row?.friendCode ?? await assignFriendCode(user.id, false) };
}

/** Replaces the code, so one that was shared around stops working. */
export async function regenerateFriendCode(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	if (!takeRateToken(`friend-code:${user.id}`, 5, 3_600_000)) throw new TooManyRequestsError();
	return { code: await assignFriendCode(user.id, true) };
}

/**
 * Called by a device that holds a platform's SDK (Meta Quest): proves the platform account is the caller's, links it to this
 * account and returns the platform friends who also linked theirs, as people the caller may send a request to. It never makes
 * anyone a friend: the reported friend ids are only the device's word, so the other person still has to accept.
 */
export async function syncProviderFriends(user: SessionUser | null, providerId: string, input: unknown) {
	if (!user) throw new UnauthorizedError();
	const provider = getFriendProvider(providerId);
	if (!provider || !provider.isAvailable()) throw new NotFoundError();
	if (!takeRateToken(`friend-sync:${user.id}`, 10, 3_600_000)) throw new TooManyRequestsError();
	const body = asObject(input);
	const externalId = await provider.verifyIdentity(body.proof);
	const friendIds = provider.parseFriendIds(body.friendIds).filter((id) => id !== externalId);

	await prisma.$transaction(async (tx) => {
		// The proof shows this platform account is the caller's, so it moves here from any account it was linked to before.
		await tx.externalFriendLink.deleteMany({ where: { provider: provider.id, OR: [{ userId: user.id }, { externalId }] } });
		await tx.externalFriendLink.create({ data: { provider: provider.id, externalId, userId: user.id } });
	});

	if (friendIds.length === 0) return { provider: provider.id, suggestions: [] };
	const links = await prisma.externalFriendLink.findMany({ where: { provider: provider.id, externalId: { in: friendIds }, userId: { not: user.id } }, select: { userId: true } });
	const candidates = links.map((link) => link.userId);
	if (candidates.length === 0) return { provider: provider.id, suggestions: [] };
	const [friendships, requests, blocks] = await Promise.all([
		prisma.friendship.findMany({ where: { OR: [{ userAId: user.id, userBId: { in: candidates } }, { userBId: user.id, userAId: { in: candidates } }] }, select: { userAId: true, userBId: true } }),
		prisma.friendRequest.findMany({ where: { OR: [{ fromUserId: user.id, toUserId: { in: candidates } }, { toUserId: user.id, fromUserId: { in: candidates } }] }, select: { fromUserId: true, toUserId: true } }),
		prisma.userBlock.findMany({ where: { OR: [{ blockerId: user.id, blockedId: { in: candidates } }, { blockedId: user.id, blockerId: { in: candidates } }] }, select: { blockerId: true, blockedId: true } })
	]);
	const skip = new Set<string>();
	for (const row of friendships) skip.add(row.userAId === user.id ? row.userBId : row.userAId);
	for (const row of requests) skip.add(row.fromUserId === user.id ? row.toUserId : row.fromUserId);
	for (const row of blocks) skip.add(row.blockerId === user.id ? row.blockedId : row.blockerId);
	const people = await prisma.user.findMany({ where: { id: { in: candidates.filter((id) => !skip.has(id)) }, OR: [{ banned: false }, { banned: null }] }, select: person });
	// Only people with a username can be asked for, which is also what a request is sent by.
	return { provider: provider.id, suggestions: people.map(publicPerson).filter((suggestion) => suggestion.username) };
}

/**
 * The pass the signaling server asks for before it lets someone into a Friends or Friends+ session: given only to the host's
 * friends (and, for Friends+, their friends), never to someone blocked. Other sessions need no pass, and the answer says so.
 */
export async function issueJoinTicket(user: SessionUser | null, roomCode: unknown) {
	if (!user) throw new UnauthorizedError();
	if (typeof roomCode !== 'string' || !roomCode || roomCode.length > 64) throw new BadRequestError('Invalid room');
	const session = await prisma.worldSession.findFirst({ where: { roomCode, endedAt: null }, select: { hostUserId: true, world: { select: { visibility: true } } } });
	const visibility = session?.world.visibility;
	if (!session || (visibility !== 'friends' && visibility !== 'friends-plus')) return { ticket: null };
	if (session.hostUserId !== user.id) {
		const reach = await reachableHosts(user.id);
		if (!(visibility === 'friends' ? reach.friends : reach.friendsPlus).has(session.hostUserId)) throw new ForbiddenError();
	}
	const secret = env.CREDITS_SECRET || env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('CREDITS_SECRET or BETTER_AUTH_SECRET must be set');
	return { ticket: signJoinTicket(secret, { r: roomCode, u: user.id, e: Date.now() + JOIN_TICKET_TTL_MS }) };
}
