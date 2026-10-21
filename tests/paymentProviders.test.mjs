import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createStripeProvider, grantFromStripeEvent, verifyStripeSignature } from '../src/lib/server/payments/stripe.ts';
import { createMetaProvider } from '../src/lib/server/payments/meta.ts';
import { CREDIT_PACKS } from '../packages/engine/src/credits/catalog.ts';

const SECRET = 'whsec_test';
const sign = (body, t = Math.floor(Date.now() / 1000), secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const pack = CREDIT_PACKS[0];
const paidEvent = (over = {}, type = 'checkout.session.completed') => ({ type, data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: pack.priceCents, currency: 'usd', client_reference_id: 'user-1', metadata: { packId: pack.id }, ...over } } });

test('Stripe signatures: valid, wrong secret, edited body, old, future and malformed', () => {
	const body = '{"a":1}';
	const now = 1_700_000_000;
	assert.equal(verifyStripeSignature(SECRET, sign(body, now), body, now), true);
	assert.equal(verifyStripeSignature(SECRET, sign(body, now, 'other'), body, now), false);
	assert.equal(verifyStripeSignature(SECRET, sign(body, now), '{"a":2}', now), false);
	assert.equal(verifyStripeSignature(SECRET, sign(body, now - 301), body, now), false, 'replayed later');
	assert.equal(verifyStripeSignature(SECRET, sign(body, now + 301), body, now), false);
	assert.equal(verifyStripeSignature(SECRET, sign(body, now - 299), body, now), true);
	for (const header of [null, '', 't=abc,v1=00', 't=1', 'v1=00', `t=${now},v1=zz`, `t=${now},v1=`]) assert.equal(verifyStripeSignature(SECRET, header, body, now), false);
	assert.equal(verifyStripeSignature(SECRET, `t=${now},v1=bad,v1=${sign(body, now).split('v1=')[1]}`, body, now), true, 'any listed signature may match');
});

test('a paid checkout credits the pack from our catalog, to the account that started it', () => {
	assert.deepEqual(grantFromStripeEvent(paidEvent()), { userId: 'user-1', pack, provider: 'stripe', providerRef: 'cs_1', idempotencyKey: 'stripe:cs_1' });
	assert.ok(grantFromStripeEvent(paidEvent({}, 'checkout.session.async_payment_succeeded')));
});

test('events that are not a completed payment of a known pack for the exact price credit nothing', () => {
	assert.equal(grantFromStripeEvent(paidEvent({ payment_status: 'unpaid' })), null);
	assert.equal(grantFromStripeEvent(paidEvent({}, 'charge.refunded')), null);
	assert.equal(grantFromStripeEvent(paidEvent({ metadata: { packId: 'credits-999999' } })), null);
	assert.equal(grantFromStripeEvent(paidEvent({ metadata: { packId: CREDIT_PACKS[2].id } })), null, 'paid the price of another pack');
	assert.equal(grantFromStripeEvent(paidEvent({ amount_total: 1 })), null);
	assert.equal(grantFromStripeEvent(paidEvent({ currency: 'eur' })), null);
	assert.equal(grantFromStripeEvent(paidEvent({ client_reference_id: undefined })), null);
	assert.equal(grantFromStripeEvent(paidEvent({ metadata: { packId: pack.id, credits: '999999' } }))?.pack.credits, pack.credits, 'metadata cannot raise the credits');
	for (const junk of [null, undefined, {}, { type: 'checkout.session.completed' }, 'x']) assert.equal(grantFromStripeEvent(junk), null);
});

test('the Stripe webhook refuses what is not signed and is not available without keys', async () => {
	const provider = createStripeProvider({ secretKey: 'sk', webhookSecret: SECRET });
	const body = JSON.stringify(paidEvent());
	assert.equal(provider.isAvailable(), true);
	assert.equal((await provider.handleWebhook(body, new Headers({ 'stripe-signature': sign(body) })))?.idempotencyKey, 'stripe:cs_1');
	await assert.rejects(provider.handleWebhook(body, new Headers({ 'stripe-signature': sign(body, undefined, 'wrong') })), /Invalid signature/);
	await assert.rejects(provider.handleWebhook(body, new Headers()), /Invalid signature/);
	assert.equal(createStripeProvider({ secretKey: 'sk' }).isAvailable(), false);
	await assert.rejects(createStripeProvider({}).handleWebhook(body, new Headers({ 'stripe-signature': sign(body) })), /Invalid signature/);
});

test('starting a Stripe checkout asks for the pack’s own price and names the account', async () => {
	const requests = [];
	const provider = createStripeProvider({ secretKey: 'sk_test', webhookSecret: SECRET }, async (url, options) => { requests.push({ url, options }); return Response.json({ url: 'https://checkout.stripe.com/c/1' }); });
	assert.deepEqual(await provider.startCheckout({ id: 'user-1', email: 'a@b.c' }, pack, { success: 'https://x/ok', cancel: 'https://x/no' }), { url: 'https://checkout.stripe.com/c/1' });
	const form = new URLSearchParams(requests[0].options.body);
	assert.equal(requests[0].options.headers.authorization, 'Bearer sk_test');
	assert.equal(form.get('client_reference_id'), 'user-1');
	assert.equal(form.get('metadata[packId]'), pack.id);
	assert.equal(form.get('line_items[0][price_data][unit_amount]'), String(pack.priceCents));
	const failing = createStripeProvider({ secretKey: 'sk' }, async () => new Response('{}', { status: 400 }));
	await assert.rejects(failing.startCheckout({ id: 'u', email: 'e' }, pack, { success: 'a', cancel: 'b' }), /Could not start/);
});

function metaFetch(answers) {
	const calls = [];
	const fetchImpl = async (url, options) => { const form = new URLSearchParams(options.body); calls.push([String(url).split('/').pop(), form.get('user_id'), form.get('sku'), form.get('access_token')]); return Response.json({ success: answers[calls.length - 1] ?? false }); };
	return { calls, fetchImpl };
}
const receipt = (over = {}) => ({ sku: pack.metaSku, purchaseToken: 'tok-1', metaUserId: '12345', ...over });

test('a Meta receipt is verified and consumed before it is credited, and credited by its token', async () => {
	const { calls, fetchImpl } = metaFetch([true, true]);
	const provider = createMetaProvider({ appId: '99', appSecret: 's3' }, fetchImpl);
	assert.deepEqual(await provider.confirmReceipt({ id: 'user-1' }, receipt()), { userId: 'user-1', pack, provider: 'meta', providerRef: 'tok-1', idempotencyKey: 'meta:tok-1', externalId: '12345' });
	assert.deepEqual(calls, [['verify_entitlement', '12345', pack.metaSku, 'OC|99|s3'], ['consume_entitlement', '12345', pack.metaSku, 'OC|99|s3']]);
});

test('the store account a receipt names is read before Meta is contacted, and only when it is well formed', () => {
	const provider = createMetaProvider({ appId: '1', appSecret: '2' });
	assert.equal(provider.externalIdOf({ metaUserId: '12345' }), '12345');
	for (const bad of [null, {}, { metaUserId: 12345 }, { metaUserId: 'abc' }, { metaUserId: '' }, { metaUserId: '1'.repeat(30) }]) assert.equal(provider.externalIdOf(bad), null);
});

test('a Meta receipt that Meta does not confirm, cannot consume, or is malformed credits nothing', async () => {
	const unconfirmed = metaFetch([false]);
	await assert.rejects(createMetaProvider({ appId: '1', appSecret: '2' }, unconfirmed.fetchImpl).confirmReceipt({ id: 'u' }, receipt()), /does not confirm/);
	assert.equal(unconfirmed.calls.length, 1, 'nothing is consumed that was not verified');
	const unconsumed = metaFetch([true, false]);
	await assert.rejects(createMetaProvider({ appId: '1', appSecret: '2' }, unconsumed.fetchImpl).confirmReceipt({ id: 'u' }, receipt()), /could not consume/);
	const never = metaFetch([true, true]);
	const provider = createMetaProvider({ appId: '1', appSecret: '2' }, never.fetchImpl);
	for (const bad of [null, {}, receipt({ sku: 'unknown' }), receipt({ purchaseToken: '' }), receipt({ purchaseToken: 'x'.repeat(600) }), receipt({ metaUserId: 'abc' }), receipt({ metaUserId: '1 OR 1' }), receipt({ metaUserId: undefined })]) {
		await assert.rejects(provider.confirmReceipt({ id: 'u' }, bad), /Invalid receipt/);
	}
	assert.equal(never.calls.length, 0, 'a bad receipt never reaches Meta');
	assert.equal(createMetaProvider({}).isAvailable(), false);
});
