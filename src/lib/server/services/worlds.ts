import { randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors';
import type { SlotTree } from '$lib/ecs/types';
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import { getActiveRoomCodes } from '../rooms';

export interface SessionUser {
	id: string;
	name: string;
	email: string;
}

function generateRoomCode(): string {
	return randomBytes(4).toString('hex');
}

/** Used by the Dash "Worlds" tab (fetched via /api/worlds) — every currently-hosted session. */
export async function listActiveWorldSessions() {
	const activeSessions = await prisma.worldSession.findMany({
		where: { endedAt: null },
		select: { id: true, roomCode: true, startedAt: true }
	});
	const liveRoomCodes = getActiveRoomCodes();
	const gracePeriod = new Date(Date.now() - 5_000);
	const staleSessionIds = activeSessions
		.filter((session) => session.startedAt < gracePeriod && !liveRoomCodes.has(session.roomCode))
		.map((session) => session.id);
	if (staleSessionIds.length > 0) {
		await prisma.worldSession.updateMany({
			where: { id: { in: staleSessionIds }, endedAt: null },
			data: { endedAt: new Date() }
		});
	}

	return prisma.worldSession.findMany({
		where: { endedAt: null, world: { visibility: 'public' } },
		include: { world: { select: { id: true, name: true, hostUserId: true, visibility: true } } },
		orderBy: { startedAt: 'desc' }
	});
}

export async function listMyWorlds(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	return prisma.world.findMany({ where: { hostUserId: user.id }, orderBy: { updatedAt: 'desc' } });
}

export async function getActiveSessionByRoomCode(roomCode: string) {
	return prisma.worldSession.findFirst({
		where: { roomCode, endedAt: null },
		include: { world: true }
	});
}

/**
 * Starts hosting the current scene: creates the `world` (first time) or
 * updates its snapshot (re-hosting), closes any stale active session for it,
 * and opens a fresh `worldSession` with a new roomCode. The caller's client
 * becomes the authoritative host for that roomCode over the signaling server.
 */
export async function startHostingSession(
	user: SessionUser | null,
	params: { worldId?: string; name?: string; visibility: HostedWorldVisibility; sceneSnapshot: SlotTree }
) {
	if (!user) throw new UnauthorizedError();

	let world = params.worldId ? await prisma.world.findUnique({ where: { id: params.worldId } }) : null;
	if (world && world.hostUserId !== user.id) throw new ForbiddenError();

	world = world
		? await prisma.world.update({
				where: { id: world.id },
				data: { sceneData: params.sceneSnapshot as object, visibility: params.visibility }
			})
		: await prisma.world.create({
				data: {
					name: params.name ?? 'My Lobby',
					hostUserId: user.id,
					sceneData: params.sceneSnapshot as object,
					visibility: params.visibility
				}
			});

	await prisma.worldSession.updateMany({
		where: { worldId: world.id, endedAt: null },
		data: { endedAt: new Date() }
	});

	const session = await prisma.worldSession.create({
		data: { worldId: world.id, hostUserId: user.id, roomCode: generateRoomCode() }
	});

	return { world, session };
}

export async function stopHostingSession(user: SessionUser | null, worldId: string) {
	if (!user) throw new UnauthorizedError();
	const world = await prisma.world.findUnique({ where: { id: worldId } });
	if (!world) throw new NotFoundError();
	if (world.hostUserId !== user.id) throw new ForbiddenError();

	await prisma.worldSession.updateMany({
		where: { worldId, endedAt: null },
		data: { endedAt: new Date() }
	});
}
