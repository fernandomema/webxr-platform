import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCredit, applySpend, applyAdjustment } from '../src/lib/server/services/creditLedger.ts';
import { CreditError } from '../src/lib/server/errors.ts';
import { CREDIT_LIMITS } from '../packages/engine/src/credits/catalog.ts';
import { createFakeDb } from './helpers/ledgerFake.mjs';

const buy = (db, userId, amount, key) => db.transaction((tx) => applyCredit(tx, { userId, amount, kind: 'purchase', provider: 'stripe', providerRef: key, idempotencyKey: key }));
const spend = (db, userId, amount, key, extra = {}) => db.transaction((tx) => applySpend(tx, { userId, amount, publicationId: 'pub', sku: 'sword', repeatable: false, idempotencyKey: key, ...extra }));
const code = (promise) => promise.then(() => null, (err) => (err instanceof CreditError ? err.code : err));

test('credits arrive once per payment, however many times the provider repeats it', async () => {
	const db = createFakeDb();
	assert.deepEqual(await buy(db, 'u', 500, 'stripe:evt_1'), { balance: 500, duplicate: false });
	assert.deepEqual(await buy(db, 'u', 500, 'stripe:evt_1'), { balance: 500, duplicate: true });
	assert.deepEqual(await buy(db, 'u', 100, 'stripe:evt_2'), { balance: 600, duplicate: false });
	assert.equal(db.state.transactions.length, 2);
	assert.deepEqual(db.state.transactions.map((t) => t.balanceAfter), [500, 600]);
});

test('spending takes the price, records the purchase and gives the player what they paid for', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 500, 'k1');
	assert.deepEqual(await spend(db, 'u', 200, 'n1'), { balance: 300, duplicate: false });
	assert.equal(db.state.entitlements.get('u|pub|sword').quantity, 1);
	const row = db.state.transactions.at(-1);
	assert.deepEqual([row.delta, row.kind, row.publicationId, row.sku, row.balanceAfter], [-200, 'spend', 'pub', 'sword', 300]);
});

test('the same confirmation twice charges once', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 500, 'k1');
	await spend(db, 'u', 200, 'n1');
	assert.deepEqual(await spend(db, 'u', 200, 'n1'), { balance: 300, duplicate: true });
	assert.equal(db.state.accounts.get('u').balance, 300);
});

test('a player without enough credits is refused and nothing changes', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 100, 'k1');
	assert.equal(await code(spend(db, 'u', 101, 'n1')), 'insufficient');
	assert.equal(await code(spend(db, 'nobody', 1, 'n2')), 'insufficient', 'an account that never held credits');
	assert.equal(db.state.accounts.get('u').balance, 100);
	assert.equal(db.state.transactions.length, 1);
	assert.equal(db.state.entitlements.size, 0);
});

test('something owned is not bought twice unless the product is repeatable; a refusal gives the credits back', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 1000, 'k1');
	await spend(db, 'u', 100, 'n1');
	assert.equal(await code(spend(db, 'u', 100, 'n2')), 'owned');
	assert.equal(db.state.accounts.get('u').balance, 900, 'the failed attempt rolled back');
	await spend(db, 'u', 50, 'n3', { sku: 'potion', repeatable: true });
	await spend(db, 'u', 50, 'n4', { sku: 'potion', repeatable: true });
	assert.equal(db.state.entitlements.get('u|pub|potion').quantity, 2);
	assert.equal(db.state.accounts.get('u').balance, 800);
});

test('entitlements belong to a player and a world: the same product code elsewhere is another product', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 1000, 'k1');
	await buy(db, 'v', 1000, 'k2');
	await spend(db, 'u', 100, 'n1');
	await spend(db, 'v', 100, 'n2');
	await spend(db, 'u', 100, 'n3', { publicationId: 'other' });
	assert.deepEqual([...db.state.entitlements.keys()].sort(), ['u|other|sword', 'u|pub|sword', 'v|pub|sword']);
});

test('daily limits: per account and per world, counting only the last 24 hours', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 100_000, 'k1');
	const world = CREDIT_LIMITS.spendPerWorldPerDay;
	await spend(db, 'u', world - 1000, 'a', { sku: 'a' });
	assert.equal(await code(spend(db, 'u', 1000, 'b', { sku: 'b' })), null, 'up to the limit of this world is fine');
	assert.equal(await code(spend(db, 'u', 1, 'c', { sku: 'c' })), 'limit', 'this world is at its daily limit');
	await spend(db, 'u', world, 'd', { sku: 'd', publicationId: 'second' });
	assert.equal(await code(spend(db, 'u', 1, 'e', { sku: 'e', publicationId: 'third' })), 'limit', 'the account is at its daily limit');
	assert.equal(db.state.accounts.get('u').balance, 100_000 - 2 * world, 'refused attempts took nothing');
	const later = Date.now() + 24 * 60 * 60 * 1000 + 1000;
	assert.equal(await code(db.transaction((tx) => applySpend(tx, { userId: 'u', amount: 1, publicationId: 'third', sku: 'e', repeatable: false, idempotencyKey: 'f' }, later))), null, 'a day later');
});

test('an account cannot hold more than the cap, and the purchase that would pass it changes nothing', async () => {
	const db = createFakeDb();
	await buy(db, 'u', CREDIT_LIMITS.maxBalance - 10, 'k1');
	assert.equal(await code(buy(db, 'u', 11, 'k2')), 'balance-cap');
	assert.equal(db.state.accounts.get('u').balance, CREDIT_LIMITS.maxBalance - 10);
	assert.deepEqual(await buy(db, 'u', 10, 'k3'), { balance: CREDIT_LIMITS.maxBalance, duplicate: false });
});

test('amounts that are not whole, positive and within the price cap are rejected', async () => {
	const db = createFakeDb();
	await buy(db, 'u', 1000, 'k1');
	for (const amount of [0, -5, 1.5, NaN, CREDIT_LIMITS.maxPrice + 1]) await assert.rejects(spend(db, 'u', amount, `bad${amount}`), /Invalid price/);
	for (const amount of [0, -5, 1.5, NaN]) await assert.rejects(buy(db, 'u', amount, `bad-credit${amount}`), /Invalid credit amount/);
	assert.equal(db.state.accounts.get('u').balance, 1000);
});

const adjust = (db, userId, amount, note, key) => db.transaction((tx) => applyAdjustment(tx, { userId, amount, note, idempotencyKey: key }));

test('an admin adjustment grants or removes credits and is recorded as such', async () => {
	const db = createFakeDb();
	assert.deepEqual(await adjust(db, 'u', 250, 'welcome grant', 'a1'), { balance: 250, duplicate: false });
	assert.deepEqual(await adjust(db, 'u', -100, 'correction', 'a2'), { balance: 150, duplicate: false });
	assert.deepEqual(await adjust(db, 'u', -100, 'welcome grant', 'a1'), { balance: 150, duplicate: true }, 'the same key applies once');
	const row = db.state.transactions.at(-1);
	assert.deepEqual([row.delta, row.kind, row.provider, row.providerRef, row.balanceAfter], [-100, 'adjustment', 'admin', 'correction', 150]);
});

test('an adjustment cannot take the balance below zero or hold more than the cap', async () => {
	const db = createFakeDb();
	assert.equal(await code(adjust(db, 'u', -1, 'nothing to take', 'a1')), 'insufficient');
	await adjust(db, 'u', 50, 'seed', 'a2');
	assert.equal(await code(adjust(db, 'u', -51, 'too much', 'a3')), 'insufficient');
	assert.equal(db.state.accounts.get('u').balance, 50);
	await adjust(db, 'u', CREDIT_LIMITS.maxBalance - 50, 'fill', 'a4');
	assert.equal(await code(adjust(db, 'u', 1, 'over the cap', 'a5')), 'balance-cap');
	assert.equal(db.state.accounts.get('u').balance, CREDIT_LIMITS.maxBalance);
});

test('adjustment amounts must be whole and within the per-adjustment limit', async () => {
	const db = createFakeDb();
	for (const amount of [0, 1.5, NaN, 100_001, -100_001]) await assert.rejects(adjust(db, 'u', amount, 'bad', `bad${amount}`), /Invalid adjustment amount/);
	assert.equal(db.state.accounts.size, 0);
});
