import { prisma } from './db';

const TTL_MS = 60_000;
const known = new Map<string, { allowed: boolean; until: number }>();

/**
 * Whether an app has been registered to run on this origin (see services/apps.ts). Asked for each API call of a game on another
 * site, so the answer is remembered for a minute.
 */
export async function appAllowsOrigin(origin: string | null): Promise<boolean> {
	if (!origin || origin === 'null') return false;
	const now = Date.now();
	const cached = known.get(origin);
	if (cached && cached.until > now) return cached.allowed;
	const allowed = Boolean(await prisma.publishedWorld.findFirst({ where: { kind: 'app', origins: { has: origin } }, select: { id: true } }));
	if (known.size > 500) known.clear();
	known.set(origin, { allowed, until: now + TTL_MS });
	return allowed;
}
