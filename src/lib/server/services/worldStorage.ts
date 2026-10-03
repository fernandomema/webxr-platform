import { prisma } from '../db';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../errors';
import { takeRateToken } from '../rateLimit';
import {
	LEADERBOARD_LIMITS, LEADERBOARD_ORDERS, STORAGE_LIMITS, StorageOpError, applyOps, assertValidBoardName, assertValidScore, isWriteOp, parseStorageRequest,
	type LeaderboardOrder, type StoredEntry
} from '$lib/worldStorage/ops';
import type { SessionUser } from './worlds';

const MAX_ATTEMPTS = 5;

/** Raised inside a transaction when a concurrent writer got there first, so the whole attempt rolls back and is retried. */
class RetryError extends Error {}

function translate(err: unknown): never {
	if (err instanceof StorageOpError) throw err.kind === 'conflict' ? new ConflictError(err.message) : new BadRequestError(err.message);
	throw err;
}

/**
 * A guest's client only stores data for the publication its room declared when the host registered it, so a host
 * cannot steer a guest into writing to another world. Hosts and solo players call without a room.
 */
async function assertRoomRuns(publicationId: string, roomCode: unknown): Promise<void> {
  if (roomCode === undefined || roomCode === null) return;
  if (typeof roomCode !== 'string' || roomCode.length > 64) throw new BadRequestError('Invalid room');
  const session = await prisma.worldSession.findUnique({ where: { roomCode }, select: { publicationId: true, endedAt: true } });
  if (!session || session.endedAt || session.publicationId !== publicationId) throw new ForbiddenError();
}

async function loadPublication(publicationId: string) {
	const publication = await prisma.publishedWorld.findUnique({ where: { id: publicationId }, select: { id: true, ownerId: true } });
	if (!publication) throw new NotFoundError();
	return publication;
}

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

/**
 * Runs a request's operations as one atomic unit. The caller's account is the only identity used for the
 * 'player' scope; the 'world' scope is shared. Writes need an account, and only the publication's owner may
 * remove shared keys. Concurrent writers are handled with a per-row version check and a retry.
 */
export async function runStorage(user: SessionUser | null, publicationId: string, body: unknown, roomCode?: unknown) {
	let request;
	try { request = parseStorageRequest(body); } catch (err) { translate(err); }
	const writes = request.ops.some(isWriteOp);
	const publication = await loadPublication(publicationId);
	if (writes) await assertRoomRuns(publicationId, roomCode);
	if (request.scope === 'player' && !user) throw new UnauthorizedError();
	if (writes) {
		if (!user) throw new UnauthorizedError();
		if (request.scope === 'world' && request.ops.some((op) => op.op === 'remove') && publication.ownerId !== user.id) throw new ForbiddenError();
		if (!takeRateToken(`storage:${user.id}:${publicationId}`, STORAGE_LIMITS.writesPerMinute)) throw new TooManyRequestsError();
	}
	const accountId = request.scope === 'player' ? user!.id : '';
	const scope = request.scope;

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		try {
			return await prisma.$transaction(async (tx) => {
				const keys = [...new Set(request.ops.map((op) => op.key))];
				const rows = await tx.worldStorageEntry.findMany({ where: { publicationId, scope, accountId, key: { in: keys } } });
				const entries = new Map<string, StoredEntry>(rows.map((row) => [row.key, { value: row.value, version: row.version }]));
				let outcome;
				try { outcome = applyOps(entries, request.ops); } catch (err) { translate(err); }
				if (!writes) return { results: outcome.results };
				let created = 0;
				let removed = 0;
				for (const [key, state] of outcome.states) {
					const existing = entries.get(key);
					if (state.kind === 'delete') {
						const { count } = await tx.worldStorageEntry.deleteMany({ where: { publicationId, scope, accountId, key, version: existing!.version } });
						if (count === 0) throw new RetryError();
						removed++;
					} else if (state.kind === 'write') {
						if (existing) {
							const { count } = await tx.worldStorageEntry.updateMany({
								where: { publicationId, scope, accountId, key, version: existing.version },
								data: { value: state.entry.value as object, version: state.entry.version }
							});
							if (count === 0) throw new RetryError();
						} else {
							await tx.worldStorageEntry.create({ data: { publicationId, scope, accountId, key, value: state.entry.value as object, version: state.entry.version } });
							created++;
						}
					}
				}
				if (created > removed) {
					const total = await tx.worldStorageEntry.count({ where: { publicationId, scope, accountId } });
					if (total > STORAGE_LIMITS.maxKeysPerScope) throw new ConflictError('Too many stored keys');
				}
				return { results: outcome.results };
			});
		} catch (err) {
			if ((err instanceof RetryError || isUniqueViolation(err)) && attempt < MAX_ATTEMPTS - 1) continue;
			if (err instanceof RetryError || isUniqueViolation(err)) throw new ConflictError('The stored data is busy; try again');
			throw err;
		}
	}
	throw new ConflictError('The stored data is busy; try again');
}

// --- leaderboards ---

function parseOrder(order: unknown): LeaderboardOrder {
	if (!LEADERBOARD_ORDERS.includes(order as LeaderboardOrder)) throw new BadRequestError('Invalid leaderboard order');
	return order as LeaderboardOrder;
}

function check(fn: () => void): void {
	try { fn(); } catch (err) { translate(err); }
}

async function rankOf(leaderboardId: string, order: LeaderboardOrder, score: number): Promise<number> {
	const better = await prisma.leaderboardEntry.count({ where: { leaderboardId, score: order === 'high' ? { gt: score } : { lt: score } } });
	return better + 1;
}

/** Records a score, keeping only the account's best. The first submit to a name creates its board with the given order; later orders are ignored. */
export async function submitScore(user: SessionUser | null, publicationId: string, name: string, score: unknown, order: unknown, roomCode?: unknown) {
	if (!user) throw new UnauthorizedError();
	check(() => { assertValidBoardName(name); assertValidScore(score); });
	const requested = parseOrder(order ?? 'high');
	await loadPublication(publicationId);
	await assertRoomRuns(publicationId, roomCode);
	if (!takeRateToken(`board:${user.id}:${publicationId}`, LEADERBOARD_LIMITS.submitsPerMinute)) throw new TooManyRequestsError();
	const value = score as number;
	const board = await prisma.leaderboard.upsert({
		where: { publicationId_name_seasonId: { publicationId, name, seasonId: '' } },
		create: { publicationId, name, order: requested, seasonId: '' },
		update: {}
	});
	const boardOrder = board.order as LeaderboardOrder;
	const existing = await prisma.leaderboardEntry.findUnique({ where: { leaderboardId_accountId: { leaderboardId: board.id, accountId: user.id } } });
	let best = value;
	let improved = false;
	if (!existing) {
		if (await prisma.leaderboardEntry.count({ where: { leaderboardId: board.id } }) >= LEADERBOARD_LIMITS.maxEntries) throw new ConflictError('This leaderboard is full');
		try {
			await prisma.leaderboardEntry.create({ data: { leaderboardId: board.id, accountId: user.id, displayName: user.name, score: value } });
			improved = true;
		} catch (err) {
			if (!isUniqueViolation(err)) throw err;
			// Two first submits raced: fall through to the conditional update below.
		}
	}
	if (!improved) {
		const { count } = await prisma.leaderboardEntry.updateMany({
			where: { leaderboardId: board.id, accountId: user.id, score: boardOrder === 'high' ? { lt: value } : { gt: value } },
			data: { score: value, displayName: user.name }
		});
		improved = count > 0;
		if (!improved) best = (await prisma.leaderboardEntry.findUnique({ where: { leaderboardId_accountId: { leaderboardId: board.id, accountId: user.id } } }))?.score ?? value;
	}
	return { order: boardOrder, score: best, improved, rank: await rankOf(board.id, boardOrder, best) };
}

/** The top rows of a board and, for a signed-in caller, their own best. A board nobody has written to yet reads as empty. */
export async function readLeaderboard(user: SessionUser | null, publicationId: string, name: string, limit: unknown) {
	check(() => assertValidBoardName(name));
	await loadPublication(publicationId);
	const take = Math.min(LEADERBOARD_LIMITS.maxTop, Math.max(1, Number.isInteger(limit) ? (limit as number) : 10));
	const board = await prisma.leaderboard.findUnique({ where: { publicationId_name_seasonId: { publicationId, name, seasonId: '' } } });
	if (!board) return { order: null, rows: [], me: null };
	const order = board.order as LeaderboardOrder;
	const rows = await prisma.leaderboardEntry.findMany({ where: { leaderboardId: board.id }, orderBy: { score: order === 'high' ? 'desc' : 'asc' }, take });
	const mine = user ? await prisma.leaderboardEntry.findUnique({ where: { leaderboardId_accountId: { leaderboardId: board.id, accountId: user.id } } }) : null;
	return {
		order,
		rows: rows.map((row, index) => ({ rank: index + 1, displayName: row.displayName, score: row.score, isMe: row.accountId === user?.id })),
		me: mine ? { score: mine.score, rank: await rankOf(board.id, order, mine.score) } : null
	};
}

