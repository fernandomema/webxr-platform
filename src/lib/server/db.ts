import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '$lib/generated/prisma/client.js';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// `prisma dev` (PGlite) serves one connection at a time: a larger pool starves every other client, including `prisma db push`.
// Set DATABASE_POOL_MAX=1 when developing against it; unset keeps the pg default.
const poolMax = Number(env.DATABASE_POOL_MAX);
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, ...(poolMax > 0 ? { max: poolMax } : {}) });

/** The database dropped the connection under a query (the single-connection dev server closes it when another client connects). */
const isDroppedConnection = (error: unknown): boolean =>
	/Connection terminated unexpectedly|Connection (reset|closed)/i.test(error instanceof Error ? error.message : '') || (error as { code?: string } | null)?.code === 'P1017';

/**
 * Against `prisma dev` a request can lose its connection to another client of the same server (the editor's Prisma extension, Prisma Studio).
 * The pool opens a fresh one for the next query, so in development a query that was cut off is run once more. Production never retries: a write
 * that was cut off after it was applied must not be repeated.
 */
function createClient(): PrismaClient {
	const client = new PrismaClient({ adapter });
	if (env.NODE_ENV === 'production') return client;
	return client.$extends({
		query: {
			async $allOperations({ args, query }) {
				try {
					return await query(args);
				} catch (error) {
					if (!isDroppedConnection(error)) throw error;
					return query(args);
				}
			}
		}
	}) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== 'production') {
	globalForPrisma.prisma = prisma;
}
