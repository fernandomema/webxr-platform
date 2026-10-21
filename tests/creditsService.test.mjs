import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { CREDIT_LIMITS, CREDIT_PACKS, SKU_PATTERN, collectProducts } from '../src/lib/credits/catalog.ts';
import { newNonce, signChallenge, verifyChallenge } from '../src/lib/server/creditChallenge.ts';
import { BadRequestError, CreditError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../src/lib/server/errors.ts';
import { applyCredit, applySpend } from '../src/lib/server/services/creditLedger.ts';
import { createFakeDb } from './helpers/ledgerFake.mjs';

const SECRET = 'service-test-secret';

/** The real service, with its imports replaced by the given stand-ins (the same way feedbackApi.test.mjs loads a route). */
function load(prisma, { providers = [], rate = () => true } = {}) {
	const source = readFileSync(new URL('../src/lib/server/services/credits.ts', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export (async )?function /gm, '$1function ');
	const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
	const names = ['env', 'CREDIT_LIMITS', 'CREDIT_PACKS', 'SKU_PATTERN', 'collectProducts', 'prisma', 'newNonce', 'signChallenge', 'verifyChallenge', 'BadRequestError', 'ForbiddenError', 'NotFoundError', 'TooManyRequestsError', 'UnauthorizedError', 'getPaymentProvider', 'getPaymentProviders', 'takeRateToken', 'applyCredit', 'applySpend'];
	const values = [{ CREDITS_SECRET: SECRET }, CREDIT_LIMITS, CREDIT_PACKS, SKU_PATTERN, collectProducts, prisma, newNonce, signChallenge, verifyChallenge, BadRequestError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError, (id) => providers.find((p) => p.id === id), () => providers, rate, applyCredit, applySpend];
	return new Function(...names, `${js}\nreturn { createPurchaseChallenge, confirmPurchase, listEntitlements, grantCredits, startCheckout, handleProviderWebhook, confirmProviderReceipt, getCreditsSummary };`)(...values);
}

const shop = (products) => [{ id: 'root', parentId: null, name: 'Shop', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'shop', products }] }];
const sword = { sku: 'sword', name: 'Sword', price: 200 };

/** A database of one published world, backed by the in-memory ledger. */
function world({ products = [sword], latestRevision = 2, sessions = {} } = {}) {
	const db = createFakeDb();
	const revisions = new Map([[1, shop([{ ...sword, price: 1 }])], [2, shop(products)]]);
	const prisma = {
		publishedWorld: { findUnique: async ({ where }) => (where.id === 'pub' ? { id: 'pub', name: 'Arena', latestRevision, owner: { name: 'Ana' } } : null) },
		publishedWorldRevision: { findUnique: async ({ where }) => (revisions.has(where.publicationId_number.number) && where.publicationId_number.publicationId === 'pub' ? { sceneData: revisions.get(where.publicationId_number.number) } : null) },
		worldSession: { findUnique: async ({ where }) => sessions[where.roomCode] ?? null },
		creditAccount: { findUnique: (args) => db.tx.creditAccount.findUnique(args) },
		productEntitlement: {
			findUnique: (args) => db.tx.productEntitlement.findUnique(args),
			findMany: async ({ where }) => [...db.state.entitlements].filter(([key]) => key.startsWith(`${where.userId}|${where.publicationId}|`)).map(([key, value]) => ({ sku: key.split('|')[2], quantity: value.quantity }))
		},
		$transaction: (fn) => db.transaction(fn)
	};
	return { db, prisma, revisions };
}
const user = { id: 'u1', name: 'Player', email: 'p@x.y' };
const fund = (db, amount = 1000) => db.transaction((tx) => applyCredit(tx, { userId: 'u1', amount, kind: 'grant', idempotencyKey: `grant-${Math.random()}` }));

test('the price in a challenge is the published one, and the sku must be one the world sells', async () => {
	const { prisma, db } = world();
	await fund(db, 300);
	const service = load(prisma);
	const offer = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword', price: 1, userId: 'someone-else' });
	assert.deepEqual([offer.product, offer.world, offer.balance, offer.owned], [{ sku: 'sword', name: 'Sword', price: 200, repeatable: false }, { name: 'Arena', owner: 'Ana' }, 300, false]);
	const challenge = verifyChallenge(SECRET, offer.token);
	assert.deepEqual([challenge.u, challenge.p, challenge.r, challenge.sku, challenge.a], ['u1', 'pub', 2, 'sword', 200]);
	await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'unknown' }), BadRequestError);
	await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'nope', sku: 'sword' }), NotFoundError);
	await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'Bad SKU!' }), BadRequestError);
	await assert.rejects(service.createPurchaseChallenge(null, { publicationId: 'pub', sku: 'sword' }), UnauthorizedError);
	await assert.rejects(service.createPurchaseChallenge(user, null), BadRequestError);
});

test('asking is rate-limited per account', async () => {
	const { prisma } = world();
	const service = load(prisma, { rate: (key) => { assert.match(key, /^credits-challenge:u1$/); return false; } });
	await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' }), TooManyRequestsError);
});

test('a guest can only price the world its room runs', async () => {
	const { prisma } = world({ sessions: { ROOM: { publicationId: 'pub', endedAt: null }, OTHER: { publicationId: 'else', endedAt: null }, OVER: { publicationId: 'pub', endedAt: new Date() } } });
	const service = load(prisma);
	assert.ok(await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword', roomCode: 'ROOM' }));
	for (const roomCode of ['OTHER', 'OVER', 'NOROOM']) await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword', roomCode }), ForbiddenError);
	await assert.rejects(service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword', roomCode: 5 }), BadRequestError);
});

test('confirming charges the agreed price once, and gives the player the product', async () => {
	const { prisma, db } = world();
	await fund(db, 500);
	const service = load(prisma);
	const { token } = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' });
	assert.deepEqual(await service.confirmPurchase(user, { token }), { ok: true, sku: 'sword', balance: 300, duplicate: false });
	assert.deepEqual(await service.confirmPurchase(user, { token }), { ok: true, sku: 'sword', balance: 300, duplicate: true }, 'a replayed token');
	assert.equal(db.state.accounts.get('u1').balance, 300);
	assert.deepEqual(await service.listEntitlements(user, 'pub'), { items: [{ sku: 'sword', quantity: 1 }] });
	assert.deepEqual(await service.listEntitlements(user, 'other'), { items: [] });
	const again = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' });
	assert.equal(again.owned, true, 'it is already theirs');
	await assert.rejects(service.confirmPurchase(user, { token: again.token }), (err) => err instanceof CreditError && err.code === 'owned');
	assert.equal(db.state.accounts.get('u1').balance, 300);
});

test('a token is for one account and cannot be forged, edited or expired', async () => {
	const { prisma, db } = world();
	await fund(db, 500);
	const service = load(prisma);
	const { token } = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' });
	await assert.rejects(service.confirmPurchase({ ...user, id: 'u2' }, { token }), BadRequestError);
	await assert.rejects(service.confirmPurchase(null, { token }), UnauthorizedError);
	await assert.rejects(service.confirmPurchase(user, { token: `${token}x` }), BadRequestError);
	await assert.rejects(service.confirmPurchase(user, { token: signChallenge('guess', verifyChallenge(SECRET, token)) }), BadRequestError);
	await assert.rejects(service.confirmPurchase(user, { token: signChallenge(SECRET, { ...verifyChallenge(SECRET, token), e: Date.now() - 1 }) }), BadRequestError);
	await assert.rejects(service.confirmPurchase(user, { token: signChallenge(SECRET, { ...verifyChallenge(SECRET, token), a: 1 }) }), BadRequestError, 'a cheaper price than the world publishes');
	await assert.rejects(service.confirmPurchase(user, null), BadRequestError);
	assert.equal(db.state.accounts.get('u1').balance, 500, 'nothing was charged');
});

test('a product the world no longer sells at that price cannot be bought with an old token', async () => {
	const { prisma, db, revisions } = world();
	await fund(db, 500);
	const service = load(prisma);
	const { token } = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' });
	revisions.set(2, shop([{ ...sword, price: 250 }]));
	await assert.rejects(service.confirmPurchase(user, { token }), BadRequestError);
	revisions.set(2, shop([]));
	await assert.rejects(service.confirmPurchase(user, { token }), BadRequestError);
	assert.equal(db.state.accounts.get('u1').balance, 500);
});

test('without enough credits the charge is refused with the reason', async () => {
	const { prisma, db } = world();
	await fund(db, 50);
	const service = load(prisma);
	const { token, balance } = await service.createPurchaseChallenge(user, { publicationId: 'pub', sku: 'sword' });
	assert.equal(balance, 50);
	await assert.rejects(service.confirmPurchase(user, { token }), (err) => err instanceof CreditError && err.code === 'insufficient');
});

test('credits from a provider are applied once per payment', async () => {
	const { prisma, db } = world();
	const grant = { userId: 'u1', pack: CREDIT_PACKS[0], provider: 'stripe', providerRef: 'cs_1', idempotencyKey: 'stripe:cs_1' };
	const stripe = { id: 'stripe', isAvailable: () => true, handleWebhook: async (body) => (body === 'paid' ? grant : null), confirmReceipt: async () => grant };
	const service = load(prisma, { providers: [stripe] });
	assert.deepEqual(await service.handleProviderWebhook('stripe', 'paid', new Headers()), { received: true });
	assert.deepEqual(await service.handleProviderWebhook('stripe', 'paid', new Headers()), { received: true });
	assert.deepEqual(await service.handleProviderWebhook('stripe', 'something-else', new Headers()), { received: true });
	assert.equal(db.state.accounts.get('u1').balance, CREDIT_PACKS[0].credits, 'delivered twice, credited once');
	await assert.rejects(service.handleProviderWebhook('unknown', 'paid', new Headers()), NotFoundError);
	const receipt = await service.confirmProviderReceipt(user, 'stripe', {});
	assert.equal(receipt.duplicate, true);
	await assert.rejects(service.confirmProviderReceipt(user, 'unknown', {}), BadRequestError);
	await assert.rejects(service.confirmProviderReceipt(null, 'stripe', {}), UnauthorizedError);
});

test('a webhook from a provider that is not configured is not served', async () => {
	const { prisma } = world();
	const service = load(prisma, { providers: [{ id: 'stripe', isAvailable: () => false, handleWebhook: async () => assert.fail('must not run') }] });
	await assert.rejects(service.handleProviderWebhook('stripe', '{}', new Headers()), NotFoundError);
});

test('checkout needs a signed-in player, a configured provider and a real pack', async () => {
	const { prisma } = world();
	const started = [];
	const stripe = { id: 'stripe', isAvailable: () => true, startCheckout: async (u, pack, urls) => { started.push([u, pack.id, urls]); return { url: 'https://pay' }; } };
	const service = load(prisma, { providers: [stripe, { id: 'meta', isAvailable: () => false }] });
	assert.deepEqual(await service.startCheckout(user, { provider: 'stripe', packId: 'credits-500' }, 'https://app'), { url: 'https://pay' });
	assert.deepEqual(started[0], [{ id: 'u1', email: 'p@x.y' }, 'credits-500', { success: 'https://app/settings/credits?payment=success', cancel: 'https://app/settings/credits?payment=cancelled' }]);
	await assert.rejects(service.startCheckout(null, { provider: 'stripe', packId: 'credits-500' }, 'https://app'), UnauthorizedError);
	await assert.rejects(service.startCheckout(user, { provider: 'stripe', packId: 'free-money' }, 'https://app'), BadRequestError);
	await assert.rejects(service.startCheckout(user, { provider: 'meta', packId: 'credits-500' }, 'https://app'), BadRequestError);
	await assert.rejects(service.startCheckout(user, { provider: 'nope', packId: 'credits-500' }, 'https://app'), BadRequestError);
});

test('a store account pays for one player: the first verified purchase links it, and nobody else can use it', async () => {
	const { prisma, db } = world();
	const links = new Map();
	prisma.paymentIdentity = {
		findUnique: async ({ where }) => links.get(`${where.provider_externalId.provider}|${where.provider_externalId.externalId}`) ?? null,
		upsert: async ({ where, create }) => { const key = `${where.provider_externalId.provider}|${where.provider_externalId.externalId}`; if (!links.has(key)) links.set(key, { userId: create.userId }); }
	};
	const confirmed = [];
	const meta = {
		id: 'meta', isAvailable: () => true,
		externalIdOf: (receipt) => receipt?.metaUserId ?? null,
		confirmReceipt: async (u, receipt) => { confirmed.push(receipt.purchaseToken); return { userId: u.id, pack: CREDIT_PACKS[0], provider: 'meta', providerRef: receipt.purchaseToken, idempotencyKey: `meta:${receipt.purchaseToken}`, externalId: receipt.metaUserId }; }
	};
	const service = load(prisma, { providers: [meta] });
	await service.confirmProviderReceipt(user, 'meta', { purchaseToken: 't1', metaUserId: '777' });
	assert.equal(links.get('meta|777').userId, 'u1');
	await assert.rejects(service.confirmProviderReceipt({ ...user, id: 'u2' }, 'meta', { purchaseToken: 't2', metaUserId: '777' }), BadRequestError);
	assert.deepEqual(confirmed, ['t1'], 'Meta was never asked to consume the other player’s purchase');
	await service.confirmProviderReceipt(user, 'meta', { purchaseToken: 't3', metaUserId: '777' });
	assert.equal(db.state.accounts.get('u1').balance, CREDIT_PACKS[0].credits * 2);
});
