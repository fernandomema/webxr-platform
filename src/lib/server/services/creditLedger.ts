import { CREDIT_LIMITS } from '@kithin/engine/credits/catalog';
import { CreditError } from '../errors.ts';

/**
 * The only code that moves a balance. Each function runs inside one database transaction (`tx`) and writes a
 * `creditTransaction` with a unique `idempotencyKey`, so a request that is retried, a challenge that is replayed or a webhook
 * that is delivered twice applies once. The balance is changed by a conditional update (`balance >= amount`), never by
 * reading it and writing a new value, so two spends at the same moment cannot both pass on the same credits.
 *
 * `tx` is the part of Prisma's transaction client used here, so the rules can be tested without a database.
 */
export interface LedgerTx {
	creditAccount: {
		upsert(args: { where: { userId: string }; create: { userId: string; balance: number }; update: Record<string, never> }): Promise<{ balance: number }>;
		updateMany(args: { where: { userId: string; balance: { gte: number } | { lte: number } }; data: { balance: { increment: number } | { decrement: number } } }): Promise<{ count: number }>;
		findUnique(args: { where: { userId: string } }): Promise<{ balance: number } | null>;
	};
	creditTransaction: {
		findUnique(args: { where: { idempotencyKey: string } }): Promise<{ delta: number; balanceAfter: number } | null>;
		create(args: { data: { userId: string; delta: number; balanceAfter: number; kind: string; provider?: string; providerRef?: string; publicationId?: string; sku?: string; idempotencyKey: string } }): Promise<unknown>;
		aggregate(args: { _sum: { delta: true }; where: { userId: string; kind: string; createdAt: { gte: Date }; publicationId?: string } }): Promise<{ _sum: { delta: number | null } }>;
	};
	productEntitlement: {
		findUnique(args: { where: { userId_publicationId_sku: { userId: string; publicationId: string; sku: string } } }): Promise<{ quantity: number } | null>;
		upsert(args: { where: { userId_publicationId_sku: { userId: string; publicationId: string; sku: string } }; create: { userId: string; publicationId: string; sku: string; quantity: number }; update: { quantity: { increment: number } } }): Promise<unknown>;
	};
}

export interface LedgerResult {
	balance: number;
	/** The same idempotency key had already been applied: nothing changed this time. */
	duplicate: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function currentBalance(tx: LedgerTx, userId: string): Promise<number> {
	return (await tx.creditAccount.findUnique({ where: { userId } }))?.balance ?? 0;
}

/** Credits arriving: a purchase confirmed by a payment provider, a grant or a refund. */
export async function applyCredit(tx: LedgerTx, input: { userId: string; amount: number; kind: 'purchase' | 'grant' | 'refund'; provider?: string; providerRef?: string; idempotencyKey: string }): Promise<LedgerResult> {
	if (!Number.isInteger(input.amount) || input.amount < 1) throw new Error('Invalid credit amount');
	const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
	if (existing) return { balance: await currentBalance(tx, input.userId), duplicate: true };
	await tx.creditAccount.upsert({ where: { userId: input.userId }, create: { userId: input.userId, balance: 0 }, update: {} });
	const { count } = await tx.creditAccount.updateMany({ where: { userId: input.userId, balance: { lte: CREDIT_LIMITS.maxBalance - input.amount } }, data: { balance: { increment: input.amount } } });
	if (count !== 1) throw new CreditError('balance-cap', `An account can hold up to ${CREDIT_LIMITS.maxBalance} credits`);
	const balance = await currentBalance(tx, input.userId);
	await tx.creditTransaction.create({
		data: { userId: input.userId, delta: input.amount, balanceAfter: balance, kind: input.kind, ...(input.provider ? { provider: input.provider } : {}), ...(input.providerRef ? { providerRef: input.providerRef } : {}), idempotencyKey: input.idempotencyKey }
	});
	return { balance, duplicate: false };
}

/** Credits leaving: the player agreed to buy `sku` in a published world. */
export async function applySpend(
	tx: LedgerTx,
	input: { userId: string; amount: number; publicationId: string; sku: string; repeatable: boolean; idempotencyKey: string },
	now = Date.now()
): Promise<LedgerResult> {
	if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > CREDIT_LIMITS.maxPrice) throw new Error('Invalid price');
	const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
	if (existing) return { balance: await currentBalance(tx, input.userId), duplicate: true };

	// Taking the credits comes first: the conditional update locks the account row, so the checks after it see every spend that came before.
	const { count } = await tx.creditAccount.updateMany({ where: { userId: input.userId, balance: { gte: input.amount } }, data: { balance: { decrement: input.amount } } });
	if (count !== 1) throw new CreditError('insufficient', 'Not enough credits');

	const key = { userId_publicationId_sku: { userId: input.userId, publicationId: input.publicationId, sku: input.sku } };
	if (!input.repeatable && (await tx.productEntitlement.findUnique({ where: key }))) throw new CreditError('owned', 'You already own this');

	const since = new Date(now - DAY_MS);
	const spentToday = -((await tx.creditTransaction.aggregate({ _sum: { delta: true }, where: { userId: input.userId, kind: 'spend', createdAt: { gte: since } } }))._sum.delta ?? 0);
	if (spentToday + input.amount > CREDIT_LIMITS.spendPerDay) throw new CreditError('limit', 'Daily spending limit reached');
	const spentHere = -((await tx.creditTransaction.aggregate({ _sum: { delta: true }, where: { userId: input.userId, kind: 'spend', createdAt: { gte: since }, publicationId: input.publicationId } }))._sum.delta ?? 0);
	if (spentHere + input.amount > CREDIT_LIMITS.spendPerWorldPerDay) throw new CreditError('limit', 'Daily spending limit for this world reached');

	const balance = await currentBalance(tx, input.userId);
	await tx.creditTransaction.create({
		data: { userId: input.userId, delta: -input.amount, balanceAfter: balance, kind: 'spend', provider: 'world', publicationId: input.publicationId, sku: input.sku, idempotencyKey: input.idempotencyKey }
	});
	await tx.productEntitlement.upsert({ where: key, create: { userId: input.userId, publicationId: input.publicationId, sku: input.sku, quantity: 1 }, update: { quantity: { increment: 1 } } });
	return { balance, duplicate: false };
}

/**
 * Credits leaving for something that is not a purchase in a world (a run of the platform's AI). It does not count toward the
 * per-world daily spending limits, which only apply to `spend`; the run's own budget is what bounds what a run can cost.
 */
export async function applyCharge(tx: LedgerTx, input: { userId: string; amount: number; kind: 'ai'; providerRef: string; idempotencyKey: string }): Promise<LedgerResult> {
	if (!Number.isInteger(input.amount) || input.amount < 1) throw new Error('Invalid charge');
	const existing = await tx.creditTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
	if (existing) return { balance: await currentBalance(tx, input.userId), duplicate: true };
	const { count } = await tx.creditAccount.updateMany({ where: { userId: input.userId, balance: { gte: input.amount } }, data: { balance: { decrement: input.amount } } });
	if (count !== 1) throw new CreditError('insufficient', 'Not enough credits');
	const balance = await currentBalance(tx, input.userId);
	await tx.creditTransaction.create({
		data: { userId: input.userId, delta: -input.amount, balanceAfter: balance, kind: input.kind, provider: input.kind, providerRef: input.providerRef, idempotencyKey: input.idempotencyKey }
	});
	return { balance, duplicate: false };
}
