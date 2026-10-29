import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCharge, applyCredit } from '../src/lib/server/services/creditLedger.ts';
import { CreditError } from '../src/lib/server/errors.ts';
import { DEFAULT_PLATFORM_MODELS, budgetExceeded, classifyTask, parsePlatformModels } from '../src/lib/server/aiPlatform.ts';
import { createFakeDb } from './helpers/ledgerFake.mjs';

const grant = (db, amount) => db.transaction((tx) => applyCredit(tx, { userId: 'u', amount, kind: 'grant', idempotencyKey: `g${amount}` }));
const charge = (db, amount, key) => db.transaction((tx) => applyCharge(tx, { userId: 'u', amount, kind: 'ai', providerRef: key, idempotencyKey: key }));

test('a run takes its fixed price once, however often the request is retried', async () => {
	const db = createFakeDb();
	await grant(db, 10);
	assert.deepEqual(await charge(db, 4, 'ai-run:1'), { balance: 6, duplicate: false });
	assert.deepEqual(await charge(db, 4, 'ai-run:1'), { balance: 6, duplicate: true });
	const row = db.state.transactions.at(-1);
	assert.deepEqual([row.delta, row.kind, row.provider, row.providerRef], [-4, 'ai', 'ai', 'ai-run:1']);
});

test('a run is refused without enough credits and nothing changes', async () => {
	const db = createFakeDb();
	await grant(db, 3);
	await assert.rejects(charge(db, 4, 'ai-run:2'), (err) => err instanceof CreditError && err.code === 'insufficient');
	assert.equal(db.state.accounts.get('u').balance, 3);
});

test('a refund returns the credits once', async () => {
	const db = createFakeDb();
	await grant(db, 10);
	await charge(db, 4, 'ai-run:3');
	const refund = () => db.transaction((tx) => applyCredit(tx, { userId: 'u', amount: 4, kind: 'refund', provider: 'ai', providerRef: '3', idempotencyKey: 'ai-refund:3' }));
	assert.equal((await refund()).balance, 10);
	assert.equal((await refund()).duplicate, true);
});

test('the budget stops a run by calls and by tokens', () => {
	const [model] = DEFAULT_PLATFORM_MODELS;
	assert.equal(budgetExceeded({ calls: 1, inputTokens: 100, outputTokens: 10 }, model), null);
	assert.match(budgetExceeded({ calls: model.maxCalls, inputTokens: 0, outputTokens: 0 }, model), /model calls/);
	assert.match(budgetExceeded({ calls: 1, inputTokens: model.maxInputTokens, outputTokens: 0 }, model), /size limit/);
	assert.match(budgetExceeded({ calls: 1, inputTokens: 0, outputTokens: model.maxOutputTokens }, model), /size limit/);
});

test('tasks are labelled from the tools used', () => {
	assert.equal(classifyTask({ list_scene: 2 }), 'ask');
	assert.equal(classifyTask({ list_scene: 1, stage_update_slot: 2 }), 'edit');
	assert.equal(classifyTask({ stage_subtree: 1, stage_update_slot: 2 }), 'create');
	assert.equal(classifyTask({ list_scene: 25 }), 'complex');
});

test('the model list can be overridden, and a malformed override falls back to the defaults', () => {
	const good = JSON.stringify([{ id: '@cf/x', label: 'X', credits: 3, maxCalls: 10, maxInputTokens: 1000, maxOutputTokens: 100 }]);
	assert.equal(parsePlatformModels(good)[0].credits, 3);
	assert.deepEqual(parsePlatformModels(undefined), [...DEFAULT_PLATFORM_MODELS]);
	assert.deepEqual(parsePlatformModels('{nope'), [...DEFAULT_PLATFORM_MODELS]);
	assert.deepEqual(parsePlatformModels(JSON.stringify([{ id: 'a', label: 'A', credits: 0, maxCalls: 1, maxInputTokens: 1, maxOutputTokens: 1 }])), [...DEFAULT_PLATFORM_MODELS]);
});

test('a run costs what its tokens cost at each rate, cache reads and writes included', async () => {
	const { runCostUsd } = await import('../src/lib/server/aiPlatform.ts');
	const rates = { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 };
	const cost = runCostUsd({ inputTokens: 1_000_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000, outputTokens: 100_000 }, rates);
	assert.ok(Math.abs(cost - (0.3 * 3 + 0.6 * 0.3 + 0.1 * 3.75 + 0.1 * 15)) < 1e-9);
});

test('the price is the cost plus the flat fee, rounded up, at 100 credits per dollar', async () => {
	const { quoteCredits, DEFAULT_PRICING } = await import('../src/lib/server/aiPlatform.ts');
	assert.equal(DEFAULT_PRICING.creditUsd, 0.01);
	assert.equal(DEFAULT_PRICING.feeFlatUsd, 1);
	// a 0.10 USD estimate + 1 USD fee = 1.10 USD = 110 credits
	assert.deepEqual(quoteCredits([], 0.1), { credits: 110, calibrated: false });
	assert.equal(quoteCredits([], 0.101).credits, 111, 'never rounds the fee away');
});

test('a run settles for its real token usage plus the fee, rounded up and capped', async () => {
	const { settleCredits } = await import('../src/lib/server/aiPlatform.ts');
	const rates = { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 };
	// 0.3M plain input + 0.6M cache reads + 0.1M cache writes + 0.1M output cost 2.955 USD; + 1 USD fee at 100 credits/USD, rounded up
	assert.equal(settleCredits({ inputTokens: 1_000_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000, outputTokens: 100_000 }, rates), 396);
	// a zero-rate run still pays the flat fee; the cap bounds the most expensive possible run
	assert.equal(settleCredits({ inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, { input: 0, output: 0 }), 100);
	assert.equal(settleCredits({ inputTokens: 100_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }, { input: 15, output: 0 }), 100_000);
});

test('measured cost replaces the estimate once there is enough data, and the percent fee applies to cost only', async () => {
	const { quoteCredits, DEFAULT_PRICING } = await import('../src/lib/server/aiPlatform.ts');
	const policy = { ...DEFAULT_PRICING, feePercent: 0.5, feeFlatUsd: 0, percentile: 0.5, minSamples: 4 };
	assert.deepEqual(quoteCredits([0.1, 0.1], 0.2, policy), { credits: 30, calibrated: false });
	assert.deepEqual(quoteCredits([0.09, 0.1, 0.1, 0.11, 0.2], 0.2, policy), { credits: 15, calibrated: true });
});

test('rates come from Cloudflare\'s catalogue, including the cached-input price', async () => {
	const { parseWorkersAiRates } = await import('../src/lib/server/aiPlatform.ts');
	const payload = { result: [{ name: '@cf/x/y', properties: [{ property_id: 'price', value: [{ unit: 'per M input tokens', price: 0.95 }, { unit: 'per M output tokens', price: 4 }, { unit: 'per M cached input tokens', price: 0.16 }] }] }] };
	assert.deepEqual(parseWorkersAiRates(payload, '@cf/x/y'), { input: 0.95, output: 4, cachedInput: 0.16 });
	assert.equal(parseWorkersAiRates(payload, '@cf/other'), null);
	assert.equal(parseWorkersAiRates({ result: [{ name: 'a', properties: [] }] }, 'a'), null);
});

test('rates come from OpenRouter per token and become per million', async () => {
	const { parseOpenRouterRates } = await import('../src/lib/server/aiPlatform.ts');
	const payload = { data: [{ id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000001', input_cache_write: '0.0000025' } }] };
	assert.deepEqual(parseOpenRouterRates(payload, 'anthropic/claude-sonnet-5.5'), { input: 2, output: 10, cachedInput: 0.1, cacheWrite: 2.5 });
	assert.equal(parseOpenRouterRates(payload, 'nope'), null);
});

test('model overrides accept rates and reject malformed ones', async () => {
	const { parsePlatformModels, DEFAULT_PLATFORM_MODELS } = await import('../src/lib/server/aiPlatform.ts');
	const base = { id: 'a/b', label: 'B', credits: 3, maxCalls: 10, maxInputTokens: 1000, maxOutputTokens: 100 };
	assert.deepEqual(parsePlatformModels(JSON.stringify([{ ...base, rates: { input: 3, output: 15 } }]))[0].rates, { input: 3, output: 15 });
	assert.deepEqual(parsePlatformModels(JSON.stringify([{ ...base, rates: { input: -1, output: 15 } }])), [...DEFAULT_PLATFORM_MODELS]);
});
