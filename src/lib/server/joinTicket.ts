import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived pass to join a session that only friends may enter. The signaling server is not connected to the account system, so
 * the platform checks the friendship over HTTP and hands the player this signed pass; signaling only has to check the signature.
 */
export interface JoinTicket {
	/** The room this pass is for. */
	r: string;
	/** The account it was given to. */
	u: string;
	/** Expiry, in ms since the epoch. */
	e: number;
}

export const JOIN_TICKET_TTL_MS = 60_000;

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`join-ticket:${body}`).digest();

export function signJoinTicket(secret: string, ticket: JoinTicket): string {
	const body = b64(JSON.stringify(ticket));
	return `${body}.${b64(mac(secret, body))}`;
}

/** Whether `token` is a genuine, unexpired pass for `roomCode`. */
export function verifyJoinTicket(secret: string, token: unknown, roomCode: string, now = Date.now()): JoinTicket | null {
	if (typeof token !== 'string' || token.length > 1024) return null;
	const [body, signature, ...rest] = token.split('.');
	if (!body || !signature || rest.length) return null;
	const expected = mac(secret, body);
	const given = Buffer.from(signature, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		const ticket = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JoinTicket;
		if (typeof ticket.r !== 'string' || typeof ticket.u !== 'string' || typeof ticket.e !== 'number') return null;
		return ticket.r === roomCode && ticket.e > now ? ticket : null;
	} catch {
		return null;
	}
}
