import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/db';

/**
 * OpenRouter's OAuth is a bare PKCE flow (no client id or secret, and the "token" is a
 * user-controlled API key), so it does not fit better-auth's OAuth providers. The key is
 * still stored as an `account` row of the signed-in user, encrypted with the auth secret.
 */
export const OPENROUTER_PROVIDER_ID = 'openrouter';

const secret = () => {
	if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not configured.');
	return env.BETTER_AUTH_SECRET;
};

const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

export function createPkce() {
	const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
	const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
	return { verifier, state };
}

export async function challengeFor(verifier: string): Promise<string> {
	return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
	const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
		signal: AbortSignal.timeout(20_000)
	});
	if (!response.ok) throw new Error('OpenRouter rejected the authorization code.');
	const body = (await response.json()) as { key?: unknown };
	if (typeof body.key !== 'string' || !body.key) throw new Error('OpenRouter returned no key.');
	return body.key;
}

export async function saveOpenRouterKey(userId: string, key: string): Promise<void> {
	const accessToken = await symmetricEncrypt({ key: secret(), data: key });
	const existing = await prisma.account.findFirst({ where: { userId, providerId: OPENROUTER_PROVIDER_ID } });
	if (existing) await prisma.account.update({ where: { id: existing.id }, data: { accessToken } });
	else await prisma.account.create({ data: { id: crypto.randomUUID(), userId, providerId: OPENROUTER_PROVIDER_ID, accountId: userId, accessToken } });
}

export async function getOpenRouterKey(userId: string): Promise<string | null> {
	const row = await prisma.account.findFirst({ where: { userId, providerId: OPENROUTER_PROVIDER_ID } });
	if (!row?.accessToken) return null;
	try { return await symmetricDecrypt({ key: secret(), data: row.accessToken }); }
	catch { return null; }
}

export async function hasOpenRouterKey(userId: string): Promise<boolean> {
	return (await prisma.account.count({ where: { userId, providerId: OPENROUTER_PROVIDER_ID, accessToken: { not: null } } })) > 0;
}

export async function deleteOpenRouterKey(userId: string): Promise<void> {
	await prisma.account.deleteMany({ where: { userId, providerId: OPENROUTER_PROVIDER_ID } });
}
