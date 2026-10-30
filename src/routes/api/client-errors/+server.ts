import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/server/db';
import { parseClientError } from '$lib/server/clientErrorInput';
import { detectDevice } from '$lib/server/deviceInfo';

/** Reports per sender per minute; a page stuck in an error loop must not fill the table. */
const PER_MINUTE = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function allowed(sender: string): boolean {
	const now = Date.now();
	if (hits.size > 5_000) for (const [key, hit] of hits) if (hit.resetAt < now) hits.delete(key);
	const hit = hits.get(sender);
	if (!hit || hit.resetAt < now) {
		hits.set(sender, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	return ++hit.count <= PER_MINUTE;
}

/**
 * Where players' browsers send the errors they hit (when they have not switched that off). Works signed out too. Nothing here may
 * ever fail loudly: the sender is a page that already has a problem.
 */
export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	if (Number(request.headers.get('content-length')) > 16_384) return json({ ok: false }, { status: 413 });
	let report;
	try {
		report = parseClientError(await request.json());
	} catch {
		report = null;
	}
	if (!report) return json({ ok: false }, { status: 400 });
	let sender = 'unknown';
	try { sender = locals.user?.id ?? getClientAddress(); } catch { /* no address */ }
	if (!allowed(sender)) return json({ ok: false }, { status: 429 });
	const userAgent = request.headers.get('user-agent')?.slice(0, 300) ?? null;
	const { platform, device } = detectDevice(userAgent, report.model);
	const { model: _model, ...fields } = report;
	try {
		await prisma.$transaction(async (tx) => {
			const existing = await tx.clientError.findUnique({ where: { fingerprint: report.fingerprint }, select: { devices: true } });
			const devices = { ...((existing?.devices as Record<string, number> | null) ?? {}) };
			devices[device] = (devices[device] ?? 0) + 1;
			const data = { userAgent, platform, device, devices, lastUserId: locals.user?.id ?? null };
			if (existing) await tx.clientError.update({ where: { fingerprint: report.fingerprint }, data: { ...data, count: { increment: 1 }, lastSeenAt: new Date(), resolved: false } });
			else await tx.clientError.create({ data: { ...fields, ...data } });
		});
	} catch (error) {
		console.error('Could not save a client error report', error);
		return json({ ok: false }, { status: 500 });
	}
	return json({ ok: true });
};
