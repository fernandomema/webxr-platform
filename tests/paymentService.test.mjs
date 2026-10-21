import assert from 'node:assert/strict';
import test from 'node:test';
import { PaymentService } from '../packages/engine/src/xr/payments/paymentService.ts';
import { createMetaPayments } from '../packages/engine/src/xr/payments/metaPayments.ts';
import { createAtmController } from '../packages/engine/src/xr/payments/atmController.ts';

/** A server that answers like the real one, recording what the client sent. */
function fakeServer({ balance = 500, price = 200, owned = false, confirm = { status: 200, data: { ok: true } }, challengeStatus = 200 } = {}) {
	const calls = [];
	let current = balance;
	return {
		calls,
		setBalance: (value) => { current = value; },
		fetch: async (url, options = {}) => {
			calls.push([String(url), options.body ? JSON.parse(options.body) : null]);
			if (String(url).startsWith('/api/credits/challenge')) {
				if (challengeStatus !== 200) return Response.json({}, { status: challengeStatus });
				return Response.json({ token: 'signed-token', expiresAt: Date.now() + 60_000, product: { sku: 'sword', name: 'Sword', price }, world: { name: 'Arena', owner: 'Ana' }, balance: current, owned });
			}
			if (String(url).startsWith('/api/credits/confirm')) return Response.json(confirm.data, { status: confirm.status });
			if (String(url).startsWith('/api/credits/entitlements')) return Response.json({ items: [{ sku: 'sword', quantity: 1 }] });
			throw new Error(`unexpected ${url}`);
		}
	};
}

function service(server, { choices = ['pay'], signedIn = true, topUp, clock = { now: 1_000_000 } } = {}) {
	const prompts = [];
	const queue = [...choices];
	const instance = new PaymentService({ fetch: server.fetch, isSignedIn: () => signedIn, prompt: async (details) => { prompts.push(details); return queue.shift() ?? 'cancel'; }, topUp, now: () => clock.now });
	return { instance, prompts, clock };
}

test('paying: the prompt shows what the server said, and the token is sent back only after the player agrees', async () => {
	const server = fakeServer();
	const { instance, prompts } = service(server);
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: true });
	assert.deepEqual(prompts.map(({ worldName, owner, productName, price, balance }) => ({ worldName, owner, productName, price, balance })), [{ worldName: 'Arena', owner: 'Ana', productName: 'Sword', price: 200, balance: 500 }]);
	assert.deepEqual(server.calls, [['/api/credits/challenge', { publicationId: 'pub', sku: 'sword' }], ['/api/credits/confirm', { token: 'signed-token' }]]);
});

test('a refusal never reaches the confirm route, and a world that keeps asking is silenced', async () => {
	const server = fakeServer();
	const { instance, prompts, clock } = service(server, { choices: ['cancel', 'cancel', 'cancel', 'pay'] });
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'declined' });
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'busy' }, 'right after a refusal');
	assert.equal(prompts.length, 1);
	clock.now += 6000;
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'declined' });
	clock.now += 6000;
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'declined' });
	clock.now += 6000;
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'declined' }, 'three refusals in a row: no more prompts, even though the player would now accept');
	assert.equal(prompts.length, 3);
	assert.equal(server.calls.some(([url]) => url === '/api/credits/confirm'), false);
	instance.reset();
	clock.now += 6000;
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: true }, 'a new session starts clean');
});

test('only one prompt is open at a time, and prompts cannot come back to back', async () => {
	const server = fakeServer();
	let release;
	const slow = new PaymentService({ fetch: server.fetch, isSignedIn: () => true, prompt: () => new Promise((resolve) => { release = resolve; }), now: () => 1_000_000 });
	const first = slow.buy('pub', 'sword');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(await slow.buy('pub', 'axe'), { ok: false, reason: 'busy' });
	release('cancel');
	assert.deepEqual(await first, { ok: false, reason: 'declined' });
	const { instance, clock } = service(server, { choices: ['pay', 'pay'] });
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: true });
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: 'busy' }, 'a second prompt straight away');
	clock.now += 2500;
	assert.deepEqual(await instance.buy('pub', 'sword'), { ok: true });
});

test('what cannot be paid for is explained without a prompt or a charge', async () => {
	assert.deepEqual(await service(fakeServer()).instance.buy(null, 'sword'), { ok: false, reason: 'unavailable' }, 'not a published world');
	assert.deepEqual(await service(fakeServer(), { signedIn: false }).instance.buy('pub', 'sword'), { ok: false, reason: 'unavailable' });
	const owned = service(fakeServer({ owned: true }));
	assert.deepEqual(await owned.instance.buy('pub', 'sword'), { ok: false, reason: 'owned' });
	assert.equal(owned.prompts.length, 0);
	assert.deepEqual(await service(fakeServer({ challengeStatus: 400 })).instance.buy('pub', 'sword'), { ok: false, reason: 'error' }, 'the world does not sell that');
	assert.deepEqual(await service(fakeServer({ challengeStatus: 429 })).instance.buy('pub', 'sword'), { ok: false, reason: 'busy' });
	assert.deepEqual(await service(fakeServer({ challengeStatus: 401 })).instance.buy('pub', 'sword'), { ok: false, reason: 'unavailable' });
});

test('without enough credits the player is told and nothing is confirmed, unless they top up and then agree', async () => {
	const server = fakeServer({ balance: 50, price: 200 });
	const noTopUp = service(server, { choices: ['pay'] });
	assert.deepEqual(await noTopUp.instance.buy('pub', 'sword'), { ok: false, reason: 'insufficient' });
	assert.equal(noTopUp.prompts[0].canTopUp, false);
	assert.equal(server.calls.some(([url]) => url === '/api/credits/confirm'), false, 'the client does not even try');

	const bought = [];
	const topUp = { isAvailable: () => true, buy: async (missing) => { bought.push(missing); server.setBalance(1200); return true; } };
	const withTopUp = service(server, { choices: ['topup', 'pay'], topUp });
	assert.deepEqual(await withTopUp.instance.buy('pub', 'sword'), { ok: true });
	assert.deepEqual(bought, [150]);
	assert.deepEqual(withTopUp.prompts.map((p) => [p.balance, p.canTopUp]), [[50, true], [1200, true]]);
	const failing = service(fakeServer({ balance: 0 }), { choices: ['topup'], topUp: { isAvailable: () => true, buy: async () => false } });
	assert.deepEqual(await failing.instance.buy('pub', 'sword'), { ok: false, reason: 'insufficient' });
});

test('the server’s reasons for refusing the charge reach the script, and nothing else does', async () => {
	for (const code of ['insufficient', 'owned', 'limit']) {
		const { instance } = service(fakeServer({ confirm: { status: 409, data: { ok: false, code, message: 'secret detail' } } }));
		assert.deepEqual(await instance.buy('pub', 'sword'), { ok: false, reason: code });
	}
	assert.deepEqual(await service(fakeServer({ confirm: { status: 500, data: null } })).instance.buy('pub', 'sword'), { ok: false, reason: 'error' });
	assert.deepEqual(await service(fakeServer({ confirm: { status: 400, data: { message: 'expired' } } })).instance.buy('pub', 'sword'), { ok: false, reason: 'error' });
	const down = new PaymentService({ fetch: async () => { throw new Error('offline'); }, isSignedIn: () => true, prompt: async () => 'pay' });
	assert.deepEqual(await down.buy('pub', 'sword'), { ok: false, reason: 'error' });
});

test('a guest names the room, so the server only prices the world that room runs', async () => {
	const server = fakeServer();
	await service(server).instance.buy('pub', 'sword', 'ROOM42');
	assert.deepEqual(server.calls[0], ['/api/credits/challenge', { publicationId: 'pub', sku: 'sword', roomCode: 'ROOM42' }]);
});

test('owning a product reads the player’s entitlements', async () => {
	const { instance } = service(fakeServer());
	assert.equal(await instance.owns('pub', 'sword'), true);
	assert.equal(await instance.owns('pub', 'axe'), false);
	assert.equal(await instance.owns(null, 'sword'), false);
});

const PACKS = [{ id: 'credits-500', credits: 500, metaSku: 'credits_500', priceCents: 499, currency: 'usd' }, { id: 'credits-1200', credits: 1200, metaSku: 'credits_1200', priceCents: 999, currency: 'usd' }];

/** The Horizon Store as a headset exposes it, recording what is asked of it. */
function metaWindow({ token = 'tok-1', userId = 777, purchases = [], onComplete = [], details, showError, listed = ['credits_500', 'credits_1200'] } = {}) {
	const log = [];
	const service = {
		getLoggedInUserId: async () => { log.push('user'); return userId; },
		getDetails: async (skus) => { log.push(['details', skus]); return (details ?? skus.filter((sku) => listed.includes(sku)).map((itemId) => ({ itemId, title: itemId, price: { currency: 'USD', value: itemId === 'credits_500' ? '3.99' : '8.99' } }))); },
		listPurchases: async () => purchases
	};
	return {
		log,
		win: {
			getDigitalGoodsService: async (url) => { assert.equal(url, 'https://quest.meta.com/billing'); log.push('service'); return service; },
			PaymentRequest: class {
				constructor(methods) { this.methods = methods; log.push(['request', methods]); }
				async show() { if (showError) throw showError; log.push('show'); return { details: { purchaseToken: token }, complete: async (result) => { log.push(['complete', result]); onComplete.push(result); } }; }
			}
		}
	};
}
const receiptServer = ({ ok = true } = {}) => {
	const sent = [];
	return { sent, fetch: async (url, options) => { sent.push([url, JSON.parse(options.body)]); return Response.json({ ok }, { status: ok ? 200 : 400 }); } };
};

test('buying a pack follows Meta’s flow: player id, store listing, payment sheet, token recorded, completed, then the server credits it', async () => {
	const server = receiptServer();
	const store = metaWindow();
	const meta = createMetaPayments({ fetch: server.fetch, win: store.win });
	assert.equal(meta.isAvailable(), true);
	assert.deepEqual(await meta.buy(PACKS[0]), { status: 'credited' });
	assert.deepEqual(store.log, ['service', 'user', ['details', ['credits_500']], ['request', [{ supportedMethods: 'https://quest.meta.com/billing', data: { sku: 'credits_500' } }]], 'show', ['complete', 'success']]);
	assert.deepEqual(server.sent, [['/api/credits/receipt', { provider: 'meta', receipt: { sku: 'credits_500', purchaseToken: 'tok-1', metaUserId: '777' } }]]);
});

test('nothing is charged without a Meta account, an item in the store, or when the player backs out', async () => {
	for (const userId of [0, '0', null, 'abc', -5]) {
		const store = metaWindow({ userId });
		const result = await createMetaPayments({ fetch: receiptServer().fetch, win: store.win }).buy(PACKS[0]);
		assert.equal(result.status, 'failed');
		assert.equal(store.log.includes('show'), false, `no payment sheet for user id ${userId}`);
	}
	const unlisted = metaWindow({ listed: [] });
	assert.equal((await createMetaPayments({ fetch: receiptServer().fetch, win: unlisted.win }).buy(PACKS[0])).status, 'failed');
	assert.equal(unlisted.log.includes('show'), false);
	const server = receiptServer();
	for (const name of ['AbortError', 'NotAllowedError']) assert.deepEqual(await createMetaPayments({ fetch: server.fetch, win: metaWindow({ showError: Object.assign(new Error('x'), { name }) }).win }).buy(PACKS[0]), { status: 'cancelled' });
	assert.equal((await createMetaPayments({ fetch: server.fetch, win: metaWindow({ showError: new Error('boom') }).win }).buy(PACKS[0])).status, 'failed');
	assert.deepEqual(server.sent, []);
});

test('a payment that went through but could not be credited right away is completed, reported, and recovered later', async () => {
	const done = [];
	const store = metaWindow({ onComplete: done });
	const down = createMetaPayments({ fetch: receiptServer({ ok: false }).fetch, win: store.win });
	const result = await down.buy(PACKS[0]);
	assert.equal(result.status, 'failed');
	assert.match(result.message, /credits will arrive/);
	assert.deepEqual(done, ['success'], 'the sheet is completed either way, or the headset keeps blocking input');
	const empty = metaWindow({ token: '', onComplete: done.splice(0) });
	assert.equal((await createMetaPayments({ fetch: receiptServer().fetch, win: empty.win }).buy(PACKS[0])).status, 'failed');
	assert.deepEqual(empty.log.filter((entry) => Array.isArray(entry) && entry[0] === 'complete'), [['complete', 'fail']]);

	const server = receiptServer();
	const pending = metaWindow({ purchases: [{ itemId: 'credits_500', purchaseToken: 'old-1' }, { itemId: 'something_else', purchaseToken: 'x' }, { itemId: 'credits_1200', purchaseToken: '' }, { itemId: 'credits_1200', purchaseToken: 'old-2' }] });
	assert.equal(await createMetaPayments({ fetch: server.fetch, win: pending.win }).recover(PACKS), 2);
	assert.deepEqual(server.sent.map(([, body]) => body.receipt.purchaseToken), ['old-1', 'old-2']);
});

test('outside the Horizon Store the machine does not offer to buy', async () => {
	assert.equal(createMetaPayments({ fetch, win: {} }).isAvailable(), false);
	assert.equal(await createMetaPayments({ fetch, win: {} }).open(), null);
	assert.equal(await createMetaPayments({ fetch, win: {} }).recover(PACKS), 0);
	const rejecting = createMetaPayments({ fetch, win: { getDigitalGoodsService: async () => { throw new Error('unsupported'); }, PaymentRequest: class {} } });
	assert.equal(rejecting.isAvailable(), true);
	assert.equal(await rejecting.open(), null);
	assert.equal((await rejecting.buy(PACKS[0])).status, 'failed');
	assert.equal((await rejecting.details(['credits_500'])).size, 0);
});

test('the purchase prompt’s top-up buys the smallest pack that covers what is missing', async () => {
	const server = receiptServer();
	const topUp = createMetaPayments({ fetch: server.fetch, win: metaWindow().win }).topUp(async () => PACKS);
	assert.equal(await topUp.buy(100), true);
	assert.equal(await topUp.buy(600), true);
	assert.equal(await topUp.buy(5000), false, 'no pack is that big');
	assert.deepEqual(server.sent.map(([, body]) => body.receipt.sku), ['credits_500', 'credits_1200']);
});

function atmServer({ balance = 120, signedIn = true, ok = true, providers = [{ id: 'stripe' }, { id: 'meta' }] } = {}) {
	let current = balance;
	return {
		set: (value) => { current = value; },
		isSignedIn: () => signedIn,
		fetch: async (url) => {
			if (!ok) return new Response('{}', { status: 500 });
			assert.equal(url, '/api/credits');
			return Response.json({ balance: current, packs: PACKS, providers });
		}
	};
}

test('the ATM shows the balance and the store’s own prices when it can sell here', async () => {
	const server = atmServer();
	const atm = createAtmController({ fetch: server.fetch, isSignedIn: server.isSignedIn, meta: createMetaPayments({ fetch: server.fetch, win: metaWindow().win }) });
	await atm.open();
	assert.equal(atm.state.phase, 'ready');
	assert.equal(atm.state.balance, 120);
	assert.equal(atm.state.canBuyHere, true);
	assert.match(atm.state.packs[0].priceLabel, /3\D99/, 'the store’s price, in the player’s format');
	assert.match(atm.state.packs[1].priceLabel, /8\D99/);
});

test('without the store the ATM lists our prices and cannot buy; signed out and offline are said plainly', async () => {
	const server = atmServer();
	const plain = createAtmController({ fetch: server.fetch, isSignedIn: server.isSignedIn, meta: createMetaPayments({ fetch: server.fetch, win: {} }) });
	await plain.open();
	assert.equal(plain.state.canBuyHere, false);
	assert.match(plain.state.packs[0].priceLabel, /4\D99/, 'our own list price');
	assert.match(plain.state.packs[1].priceLabel, /9\D99/);
	await plain.buy('credits-500');
	assert.equal(plain.state.busy, null);
	const noMeta = atmServer({ providers: [{ id: 'stripe' }] });
	const unconfigured = createAtmController({ fetch: noMeta.fetch, isSignedIn: noMeta.isSignedIn, meta: createMetaPayments({ fetch: noMeta.fetch, win: metaWindow().win }) });
	await unconfigured.open();
	assert.equal(unconfigured.state.canBuyHere, false, 'the server does not accept Meta receipts');
	const out = atmServer({ signedIn: false });
	const signedOut = createAtmController({ fetch: out.fetch, isSignedIn: out.isSignedIn, meta: createMetaPayments({ fetch: out.fetch, win: {} }) });
	await signedOut.open();
	assert.equal(signedOut.state.phase, 'signed-out');
	const down = atmServer({ ok: false });
	const failing = createAtmController({ fetch: down.fetch, isSignedIn: down.isSignedIn, meta: createMetaPayments({ fetch: down.fetch, win: {} }) });
	await failing.open();
	assert.equal(failing.state.phase, 'error');
});

test('buying at the ATM shows the progress, then the new balance; backing out says nothing; purchases left unfinished are credited on opening', async () => {
	const server = atmServer({ balance: 100 });
	const receipts = [];
	const fetchBoth = async (url, options) => {
		if (url === '/api/credits/receipt') { receipts.push(JSON.parse(options.body).receipt.purchaseToken); server.set(600); return Response.json({ ok: true }); }
		return server.fetch(url, options);
	};
	const store = metaWindow();
	const atm = createAtmController({ fetch: fetchBoth, isSignedIn: server.isSignedIn, meta: createMetaPayments({ fetch: fetchBoth, win: store.win }) });
	await atm.open();
	const seen = [];
	atm.subscribe((state) => seen.push([state.busy, state.message]));
	await atm.buy('credits-500');
	assert.deepEqual(seen.at(-1), [null, '500 credits added.']);
	assert.ok(seen.some(([busy]) => busy === 'credits-500'));
	assert.equal(atm.state.balance, 600);

	const cancelling = createAtmController({ fetch: server.fetch, isSignedIn: server.isSignedIn, meta: createMetaPayments({ fetch: server.fetch, win: metaWindow({ showError: Object.assign(new Error('x'), { name: 'AbortError' }) }).win }) });
	await cancelling.open();
	await cancelling.buy('credits-500');
	assert.equal(cancelling.state.message, '');

	receipts.length = 0;
	const recovering = metaWindow({ purchases: [{ itemId: 'credits_500', purchaseToken: 'left-over' }] });
	const reopened = createAtmController({ fetch: fetchBoth, isSignedIn: server.isSignedIn, meta: createMetaPayments({ fetch: fetchBoth, win: recovering.win }) });
	await reopened.open();
	assert.deepEqual(receipts, ['left-over']);
	assert.equal(reopened.state.message, 'Credits from an earlier purchase were added.');
	assert.equal(reopened.state.balance, 600);
});
