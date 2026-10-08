import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '$lib/generated/prisma/client.js';
import { env } from '$env/dynamic/private';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// `prisma dev` (PGlite) serves one connection at a time: a larger pool starves every other client, including `prisma db push`.
// Set DATABASE_POOL_MAX=1 when developing against it; unset keeps the pg default.
const poolMax = Number(env.DATABASE_POOL_MAX);
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, ...(poolMax > 0 ? { max: poolMax } : {}) });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== 'production') {
	globalForPrisma.prisma = prisma;
}
