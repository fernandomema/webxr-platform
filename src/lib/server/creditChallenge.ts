import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A purchase challenge: what the server agreed to charge, for whom, signed so the client can neither change it nor mint one.
 * The player's client gets it when it asks to pay, shows its contents to the player and, only if they agree, sends it back.
 * Code blocks never see it: they run in a sandbox that cannot call these routes, and `ctx.pay.request` hands them a yes or a no.
 */
export interface PurchaseChallenge {
	/** The account that will pay. */
	u: string;
	/** The published world and its revision the price was read from. */
	p: string;
	r: number;
	sku: string;
	/** Credits, as shown to the player. */
	a: number;
	/** One use: it is the idempotency key of the charge. */
	n: string;
	/** Expiry, in ms since the epoch. */
	e: number;
}

const b64 = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`purchase-challenge:${body}`).digest();

export function newNonce(): string {
	return randomBytes(18).toString('base64url');
}

export function signChallenge(secret: string, challenge: PurchaseChallenge): string {
	const body = b64(JSON.stringify(challenge));
	return `${body}.${b64(mac(secret, body))}`;
}

/** The challenge a token carries, or `null` when it is forged, malformed or expired. */
export function verifyChallenge(secret: string, token: unknown, now = Date.now()): PurchaseChallenge | null {
	if (typeof token !== 'string' || token.length > 2048) return null;
	const [body, signature, ...rest] = token.split('.');
	if (!body || !signature || rest.length) return null;
	const expected = mac(secret, body);
	let given: Buffer;
	try { given = Buffer.from(signature, 'base64url'); } catch { return null; }
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	let value: Partial<PurchaseChallenge>;
	try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
	if (typeof value.u !== 'string' || typeof value.p !== 'string' || typeof value.sku !== 'string' || typeof value.n !== 'string') return null;
	if (!Number.isInteger(value.r) || !Number.isInteger(value.a) || !Number.isFinite(value.e) || (value.a as number) < 1) return null;
	if (now > (value.e as number)) return null;
	return value as PurchaseChallenge;
}
