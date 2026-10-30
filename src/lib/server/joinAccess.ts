import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { verifyJoinTicket } from './joinTicket.ts';

// Used by the signaling server, which runs outside the app's request handling (no `$env`, no shared Prisma): like
// sessionLifecycle.ts it reads the environment directly and keeps a client of its own.
const shared = globalThis as unknown as { joinAccessPrisma?: PrismaClient };
function database(): PrismaClient {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is required for signaling access checks');
	return (shared.joinAccessPrisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }));
}

export function ticketSecret(): string {
	const value = process.env.CREDITS_SECRET || process.env.BETTER_AUTH_SECRET;
	if (!value) throw new Error('CREDITS_SECRET or BETTER_AUTH_SECRET must be set');
	return value;
}

/** Whether the room is a session only friends may enter (anything else, including a room that does not exist, needs no pass). */
export async function roomNeedsTicket(roomCode: string): Promise<boolean> {
	const session = await database().worldSession.findFirst({ where: { roomCode, endedAt: null, world: { visibility: { in: ['friends', 'friends-plus'] } } }, select: { id: true } });
	return Boolean(session);
}

/** Whether a guest may join `roomCode` with `ticket`. */
export async function mayJoin(roomCode: string, ticket: unknown): Promise<boolean> {
	if (!await roomNeedsTicket(roomCode)) return true;
	return verifyJoinTicket(ticketSecret(), ticket, roomCode) !== null;
}
