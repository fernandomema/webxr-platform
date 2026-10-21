import { env } from '$env/dynamic/private';
import { CREDIT_LIMITS, CREDIT_PACKS, SKU_PATTERN, collectProducts, type CreditPack } from '$lib/credits/catalog';
import { prisma } from '../db';
import { newNonce, signChallenge, verifyChallenge } from '../creditChallenge';
import { BadRequestError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../errors';
import { getPaymentProvider, getPaymentProviders } from '../payments';
import type { CreditGrant } from '../payments/types';
import { takeRateToken } from '../rateLimit';
import { applyCredit, applySpend, type LedgerResult, type LedgerTx } from './creditLedger';
import type { SessionUser } from './worlds';

const MAX_ATTEMPTS = 3;

function secret(): string {
	const value = env.CREDITS_SECRET || env.BETTER_AUTH_SECRET;
	if (!value) throw new Error('CREDITS_SECRET or BETTER_AUTH_SECRET must be set');
	return value;
}

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';

/**
 * Runs a ledger operation in a transaction. Two requests with the same idempotency key at the same moment both pass the
 * "already applied?" check; the unique key makes the second one's insert fail and roll back, and its retry then finds the first.
 */
async function inLedgerTransaction<T>(run: (tx: LedgerTx) => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await prisma.$transaction((tx) => run(tx as unknown as LedgerTx));
		} catch (err) {
			if (!isUniqueViolation(err) || attempt + 1 >= MAX_ATTEMPTS) throw err;
		}
	}
}

export async function getCreditsSummary(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const [account, transactions] = await Promise.all([
		prisma.creditAccount.findUnique({ where: { userId: user.id } }),
		prisma.creditTransaction.findMany({
			where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50,
			select: { id: true, delta: true, balanceAfter: true, kind: true, provider: true, publicationId: true, sku: true, createdAt: true }
		})
	]);
	return {
		balance: account?.balance ?? 0,
		transactions,
		packs: CREDIT_PACKS.map(({ id, credits, priceCents, currency, metaSku }) => ({ id, credits, priceCents, currency, metaSku })),
		providers: getPaymentProviders().filter((provider) => provider.isAvailable()).map(({ id, label }) => ({ id, label }))
	};
}

/** A guest's client only pays for the world its room runs, so a host cannot steer it into paying in another (the same rule storage follows). */
async function assertRoomRuns(publicationId: string, roomCode: unknown): Promise<void> {
	if (roomCode === undefined || roomCode === null) return;
	if (typeof roomCode !== 'string' || roomCode.length > 64) throw new BadRequestError('Invalid room');
	const session = await prisma.worldSession.findUnique({ where: { roomCode }, select: { publicationId: true, endedAt: true } });
	if (!session || session.endedAt || session.publicationId !== publicationId) throw new ForbiddenError();
}

/**
 * The player's client asks what a product costs in a published world. The price comes from the published revision, not from
 * the client or the script. The answer carries a signed challenge: the client shows it to the player and sends it back only if they agree.
 */
export async function createPurchaseChallenge(user: SessionUser | null, body: unknown) {
	if (!user) throw new UnauthorizedError();
	const { publicationId, sku, roomCode } = (body ?? {}) as { publicationId?: unknown; sku?: unknown; roomCode?: unknown };
	if (typeof publicationId !== 'string' || !publicationId || publicationId.length > 64 || typeof sku !== 'string' || !SKU_PATTERN.test(sku)) throw new BadRequestError('Invalid product');
	if (!takeRateToken(`credits-challenge:${user.id}`, CREDIT_LIMITS.challengesPerMinute)) throw new TooManyRequestsError();
	await assertRoomRuns(publicationId, roomCode);

	const publication = await prisma.publishedWorld.findUnique({ where: { id: publicationId }, select: { id: true, name: true, latestRevision: true, owner: { select: { name: true } } } });
	if (!publication) throw new NotFoundError();
	const revision = await prisma.publishedWorldRevision.findUnique({ where: { publicationId_number: { publicationId, number: publication.latestRevision } }, select: { sceneData: true } });
	if (!revision) throw new NotFoundError();
	let product;
	try { product = collectProducts(revision.sceneData).get(sku); } catch { throw new BadRequestError('This world has an invalid shop'); }
	if (!product) throw new BadRequestError('This world does not sell that');

	const [account, owned] = await Promise.all([
		prisma.creditAccount.findUnique({ where: { userId: user.id } }),
		prisma.productEntitlement.findUnique({ where: { userId_publicationId_sku: { userId: user.id, publicationId, sku } } })
	]);
	const expiresAt = Date.now() + CREDIT_LIMITS.challengeTtlMs;
	const token = signChallenge(secret(), { u: user.id, p: publicationId, r: publication.latestRevision, sku, a: product.price, n: newNonce(), e: expiresAt });
	return {
		token,
		expiresAt,
		product: { sku: product.sku, name: product.name, price: product.price, repeatable: product.repeatable },
		world: { name: publication.name, owner: publication.owner.name },
		balance: account?.balance ?? 0,
		owned: Boolean(owned) && !product.repeatable
	};
}

/** The player agreed: take the credits and record what they bought. A token works once. */
export async function confirmPurchase(user: SessionUser | null, body: unknown) {
	if (!user) throw new UnauthorizedError();
	const challenge = verifyChallenge(secret(), (body as { token?: unknown } | null)?.token);
	if (!challenge || challenge.u !== user.id) throw new BadRequestError('This purchase expired. Try again.');
	// The price the player saw is the one in the token, but the product must still be on sale in the world.
	const publication = await prisma.publishedWorld.findUnique({ where: { id: challenge.p }, select: { latestRevision: true } });
	if (!publication) throw new NotFoundError();
	const revision = await prisma.publishedWorldRevision.findUnique({ where: { publicationId_number: { publicationId: challenge.p, number: challenge.r } }, select: { sceneData: true } });
	let product;
	try { product = revision ? collectProducts(revision.sceneData).get(challenge.sku) : undefined; } catch { product = undefined; }
	if (!product || product.price !== challenge.a) throw new BadRequestError('This is no longer on sale');
	const result: LedgerResult = await inLedgerTransaction((tx) => applySpend(tx, { userId: user.id, amount: challenge.a, publicationId: challenge.p, sku: challenge.sku, repeatable: product.repeatable, idempotencyKey: `spend:${challenge.n}` }));
	return { ok: true as const, sku: challenge.sku, balance: result.balance, duplicate: result.duplicate };
}

export async function listEntitlements(user: SessionUser | null, publicationId: unknown) {
	if (!user) throw new UnauthorizedError();
	if (typeof publicationId !== 'string' || !publicationId || publicationId.length > 64) throw new BadRequestError('Invalid world');
	const rows = await prisma.productEntitlement.findMany({ where: { userId: user.id, publicationId }, select: { sku: true, quantity: true } });
	return { items: rows };
}

/** Credits a payment a provider has confirmed. Safe to call again for the same payment. */
export async function grantCredits(grant: CreditGrant): Promise<LedgerResult> {
	return inLedgerTransaction((tx) => applyCredit(tx, { userId: grant.userId, amount: grant.pack.credits, kind: 'purchase', provider: grant.provider, providerRef: grant.providerRef, idempotencyKey: grant.idempotencyKey }));
}

export async function startCheckout(user: SessionUser | null, body: unknown, origin: string) {
	if (!user) throw new UnauthorizedError();
	const { provider: providerId, packId } = (body ?? {}) as { provider?: unknown; packId?: unknown };
	const provider = getPaymentProvider(providerId);
	const pack: CreditPack | undefined = CREDIT_PACKS.find((candidate) => candidate.id === packId);
	if (!provider?.startCheckout || !provider.isAvailable() || !pack) throw new BadRequestError('Payment is not available');
	if (!takeRateToken(`credits-checkout:${user.id}`, 10)) throw new TooManyRequestsError();
	return provider.startCheckout({ id: user.id, email: user.email }, pack, { success: `${origin}/settings/credits?payment=success`, cancel: `${origin}/settings/credits?payment=cancelled` });
}

export async function handleProviderWebhook(providerId: string, rawBody: string, headers: Headers) {
	const provider = getPaymentProvider(providerId);
	if (!provider?.handleWebhook || !provider.isAvailable()) throw new NotFoundError();
	const grant = await provider.handleWebhook(rawBody, headers);
	if (!grant) return { received: true };
	await grantCredits(grant);
	return { received: true };
}

export async function confirmProviderReceipt(user: SessionUser | null, providerId: unknown, receipt: unknown) {
	if (!user) throw new UnauthorizedError();
	const provider = getPaymentProvider(providerId);
	if (!provider?.confirmReceipt || !provider.isAvailable()) throw new BadRequestError('Payment is not available');
	if (!takeRateToken(`credits-receipt:${user.id}`, 10)) throw new TooManyRequestsError();
	// A store account that already paid for another player is not served: checked before the provider consumes anything.
	const externalId = provider.externalIdOf?.(receipt) ?? null;
	if (externalId) {
		const linked = await prisma.paymentIdentity.findUnique({ where: { provider_externalId: { provider: provider.id, externalId } }, select: { userId: true } });
		if (linked && linked.userId !== user.id) throw new BadRequestError('This store account belongs to another player');
	}
	let grant: CreditGrant;
	try { grant = await provider.confirmReceipt({ id: user.id }, receipt); } catch (err) { throw new BadRequestError(err instanceof Error ? err.message : 'Invalid receipt'); }
	const result = await grantCredits(grant);
	if (grant.externalId) {
		// The first verified purchase links the store account to this player.
		await prisma.paymentIdentity.upsert({ where: { provider_externalId: { provider: grant.provider, externalId: grant.externalId } }, create: { provider: grant.provider, externalId: grant.externalId, userId: user.id }, update: {} });
	}
	return { ok: true as const, ...result };
}
