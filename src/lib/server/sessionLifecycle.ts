import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const globalForSessionCleanup = globalThis as unknown as { sessionCleanupPrisma?: PrismaClient };
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for signaling session cleanup');

const prisma = globalForSessionCleanup.sessionCleanupPrisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
if (process.env.NODE_ENV !== 'production') globalForSessionCleanup.sessionCleanupPrisma = prisma;

/** Ends persisted sessions whose host WebSocket has disconnected. */
export async function endSessionsByRoomCodes(roomCodes: readonly string[]): Promise<void> {
	if (roomCodes.length === 0) return;
	await prisma.worldSession.updateMany({
		where: { roomCode: { in: [...roomCodes] }, endedAt: null },
		data: { endedAt: new Date() }
	});
}
