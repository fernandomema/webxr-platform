import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { prisma } from '../db';
import { AI_TARIFF_VERSION, DEFAULT_PRICING, RUN_OUTCOMES, TYPICAL_RUN, budgetExceeded, classifyTask, isWorkersAiModel, parseOpenRouterRates, parsePlatformModels, parseWorkersAiRates, quoteCredits, runCostUsd, settleCredits, type ModelRates, type PricingPolicy, type PlatformModel, type RunOutcome, type RunUsage } from '../aiPlatform';
import { AiBudgetError, BadRequestError, ConflictError, CreditError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../errors';
import { takeRateToken } from '../rateLimit';
import { applyCharge, type LedgerTx } from './creditLedger';
import type { SessionUser } from './worlds';

const MAX_PAYLOAD = 500_000;
const MAX_ANSWER = 2_000_000;
const MAX_TOOL_CALLS_REPORTED = 100_000;

/** Gateway models need CLOUDFLARE_AI_GATEWAY; without it only the Workers AI ones are offered. */
const models = () => parsePlatformModels(env.PLATFORM_AI_MODELS).filter((model) => isWorkersAiModel(model.id) || Boolean(env.CLOUDFLARE_AI_GATEWAY));
const available = () => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN);
const envNumber = (value: string | undefined, fallback: number, min: number, max: number): number => {
	const parsed = Number(value);
	return value && Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const policy = (): PricingPolicy => ({
	...DEFAULT_PRICING,
	feePercent: envNumber(env.PLATFORM_AI_FEE_PERCENT, DEFAULT_PRICING.feePercent, 0, 10),
	feeFlatUsd: envNumber(env.PLATFORM_AI_FEE_USD, DEFAULT_PRICING.feeFlatUsd, 0, 1000),
	creditUsd: envNumber(env.PLATFORM_AI_CREDIT_USD, DEFAULT_PRICING.creditUsd, 0.0001, 10),
	minSamples: envNumber(env.PLATFORM_AI_MIN_SAMPLES, DEFAULT_PRICING.minSamples, 1, 100_000)
});

const RATES_TTL_MS = 12 * 3_600_000;
const RATES_RETRY_MS = 5 * 60_000;
const ratesCache = new Map<string, { at: number; rates: ModelRates | null }>();
const ratesInFlight = new Map<string, Promise<ModelRates | null>>();

async function fetchRates(model: PlatformModel): Promise<ModelRates | null> {
	if (isWorkersAiModel(model.id)) {
		const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?search=${encodeURIComponent(model.id)}&per_page=20`, {
			headers: { authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}` }, signal: AbortSignal.timeout(15_000)
		});
		return response.ok ? parseWorkersAiRates(await response.json(), model.id) : null;
	}
	if (!model.ratesFrom) return null;
	const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
	return response.ok ? parseOpenRouterRates(await response.json(), model.ratesFrom) : null;
}

/**
 * What the provider charges for `model`. An explicit `rates` in the catalogue wins; otherwise they are fetched from the
 * provider's price list and kept for hours, so the lists are not asked for on every request. If a refresh fails the last known
 * rates keep being used, and a model with none falls back to its rough credit estimate (retried every few minutes).
 */
async function ratesOf(model: PlatformModel): Promise<ModelRates | null> {
	if (model.rates) return model.rates;
	const cached = ratesCache.get(model.id);
	if (cached && Date.now() - cached.at < (cached.rates ? RATES_TTL_MS : RATES_RETRY_MS)) return cached.rates;
	let pending = ratesInFlight.get(model.id);
	if (!pending) {
		pending = fetchRates(model).catch(() => null).then((rates) => {
			ratesCache.set(model.id, { at: Date.now(), rates: rates ?? cached?.rates ?? null });
			return rates ?? cached?.rates ?? null;
		}).finally(() => ratesInFlight.delete(model.id));
		ratesInFlight.set(model.id, pending);
	}
	return pending;
}

const PRICE_WINDOW_DAYS = 14;
const PRICE_SAMPLE_RUNS = 500;
const PRICE_TTL_MS = 10 * 60_000;
const quotes = new Map<string, { at: number; credits: number; calibrated: boolean }>();

/**
 * What a run of `model` is expected to cost now: its cost plus the fee. The cost is the measured cost of the latest completed runs once
 * there are enough, before that an estimate of a typical run at the model's rates. Quotes are cached for a few minutes so the
 * estimate on the button is stable; the run itself settles for its real usage when it ends. Cost is computed from the
 * recorded tokens, so a changed rate re-prices the whole history.
 */
async function priceOf(model: PlatformModel): Promise<{ credits: number; calibrated: boolean }> {
	const cached = quotes.get(model.id);
	if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached;
	const rates = await ratesOf(model);
	const pricing = policy();
	let costs: number[] = [];
	if (rates) {
		const runs = await prisma.aiRun.findMany({
			where: { model: model.id, status: 'completed', okCalls: { gt: 0 }, createdAt: { gte: new Date(Date.now() - PRICE_WINDOW_DAYS * 86_400_000) } },
			orderBy: { createdAt: 'desc' }, take: PRICE_SAMPLE_RUNS,
			select: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true }
		});
		costs = runs.map((run) => runCostUsd(run, rates));
	}
	const quote = quoteCredits(costs, rates ? runCostUsd(TYPICAL_RUN, rates) : model.credits * pricing.creditUsd, pricing);
	quotes.set(model.id, { at: Date.now(), ...quote });
	return quote;
}

/** Nothing is charged in development or while the free calibration phase is on, but usage is recorded either way. */
const isFree = () => dev || env.PLATFORM_AI_FREE === 'true';

function modelOrThrow(id: unknown): PlatformModel {
	const model = models().find((candidate) => candidate.id === id);
	if (!model) throw new BadRequestError('Unknown model');
	return model;
}

/** What the panel shows before anything is sent: the models, the estimated price of a run of each, and the balance. */
export async function getPlatformInfo(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const free = isFree();
	const account = await prisma.creditAccount.findUnique({ where: { userId: user.id } });
	return {
		available: available(),
		free,
		balance: account?.balance ?? 0,
		models: await Promise.all(models().map(async (model) => {
			const quote = await priceOf(model);
			return { id: model.id, label: model.label, credits: free ? 0 : quote.credits, calibrated: quote.calibrated };
		}))
	};
}

/** Opens the run every model call of one message belongs to. Nothing is charged here: the run settles for its real usage in `finishRun`. */
export async function startRun(user: SessionUser | null, body: unknown) {
	if (!user) throw new UnauthorizedError();
	if (!available()) throw new ConflictError('The platform AI is not available.');
	const model = modelOrThrow((body as { model?: unknown } | null)?.model);
	if (!takeRateToken(`ai-run:${user.id}`, 30)) throw new TooManyRequestsError();
	const free = isFree();
	const estimate = free ? 0 : (await priceOf(model)).credits;
	const account = await prisma.creditAccount.findUnique({ where: { userId: user.id } });
	// A paid run settles for what it really used, so it needs at least something on the account; the exact amount is taken at settle time.
	if (!free && (account?.balance ?? 0) < 1) throw new CreditError('insufficient', 'Not enough credits for this request.');
	const id = crypto.randomUUID();
	await prisma.aiRun.create({ data: { id, userId: user.id, model: model.id, free, quotedCredits: estimate, tariffVersion: AI_TARIFF_VERSION } });
	return { runId: id, estimate, balance: account?.balance ?? 0 };
}

const toCount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** What runs really cost, in credits, at the provider's current rates and without the platform fee. Runs whose model has no known rates (or is no longer offered) are omitted. */
export async function measureRunCosts(runs: (RunUsage & { id: string; model: string })[]): Promise<Map<string, number>> {
	const costs = new Map<string, number>();
	const creditUsd = policy().creditUsd;
	await Promise.all(runs.map(async (run) => {
		const model = models().find((candidate) => candidate.id === run.model);
		const rates = model ? await ratesOf(model) : null;
		if (rates) costs.set(run.id, runCostUsd(run, rates) / creditUsd);
	}));
	return costs;
}

/**
 * One model call of a run. The model, the output limit and the account come from the server, never from the browser; the
 * answer is recorded (tokens only) before it is returned.
 */
export async function runStep(user: SessionUser | null, body: Record<string, unknown>, sessionAffinity: string, signal: AbortSignal): Promise<Response> {
	if (!user) throw new UnauthorizedError();
	if (!available()) throw new ConflictError('The platform AI is not available.');
	if (typeof body.runId !== 'string' || body.runId.length > 64) throw new BadRequestError('Missing run');
	const run = await prisma.aiRun.findUnique({ where: { id: body.runId } });
	if (!run || run.userId !== user.id) throw new NotFoundError();
	if (run.status !== 'running') throw new ConflictError('This request already ended.');
	const model = models().find((candidate) => candidate.id === run.model);
	if (!model) throw new ConflictError('This model is no longer offered.');
	const limit = budgetExceeded(run, model);
	if (limit) throw new AiBudgetError(limit);
	if (!takeRateToken(`ai-step:${user.id}`, 90)) throw new TooManyRequestsError();

	const payload = body.payload as Record<string, unknown> | undefined;
	if (!payload || !Array.isArray(payload.messages) || !Array.isArray(payload.tools) || payload.tools.length > 20) throw new BadRequestError('Invalid model or tools.');
	// One conversation keeps one affinity / cache key across its messages, so a follow-up reads the previous message's cache.
	const affinity = /^[A-Za-z0-9-]{8,64}$/.test(sessionAffinity) ? sessionAffinity : run.id;
	// OpenAI's newer models refuse `max_tokens` (they take `max_completion_tokens`), and on /chat/completions they cannot reason and call
	// tools in the same request, so reasoning is switched off: the agent needs the tools.
	const isOpenAi = model.id.startsWith('openai/');
	const serialized = JSON.stringify({ model: model.id, messages: payload.messages, tools: payload.tools, stream: false, ...(isOpenAi ? { max_completion_tokens: 4096, prompt_cache_key: affinity, reasoning_effort: 'none' } : { max_tokens: 4096 }) });
	if (serialized.length > MAX_PAYLOAD) throw new BadRequestError('Request is too large.');

	const started = Date.now();
	let status = 0;
	let error: string | undefined;
	let answer = '';
	let contentType = 'application/json';
	try {
		const viaGateway = !isWorkersAiModel(model.id);
		if (viaGateway && !env.CLOUDFLARE_AI_GATEWAY) throw new ConflictError('The platform AI is not available.');
		const endpoint = viaGateway
			? `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_AI_GATEWAY}/compat/chat/completions`
			: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`;
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...(viaGateway ? { 'cf-aig-authorization': `Bearer ${env.CLOUDFLARE_AI_TOKEN}` } : { authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}` }), 'x-session-affinity': affinity },
			body: serialized,
			signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)])
		});
		status = response.status;
		contentType = response.headers.get('content-type') ?? contentType;
		answer = await response.text();
		if (answer.length > MAX_ANSWER) { status = 502; error = 'Provider response is too large.'; }
		else if (!response.ok) error = answer.slice(0, 300);
	} catch (caught) {
		error = signal.aborted ? 'aborted' : caught instanceof Error ? caught.message.slice(0, 300) : 'unreachable';
	}

	let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	if (!error) {
		try {
			const data = JSON.parse(answer) as { usage?: Record<string, unknown> & { prompt_tokens_details?: Record<string, unknown> } };
			const u = data.usage ?? {};
			usage = { input: toCount(u.prompt_tokens), output: toCount(u.completion_tokens), cacheRead: toCount(u.prompt_tokens_details?.cached_tokens), cacheWrite: toCount(u.prompt_tokens_details?.cache_write_tokens) };
		} catch { error = 'invalid-json'; }
	}
	const ok = !error;
	await prisma.$transaction([
		prisma.aiCall.create({ data: { runId: run.id, provider: 'cloudflare', model: model.id, inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, latencyMs: Date.now() - started, status, error: error ?? null } }),
		prisma.aiRun.update({ where: { id: run.id }, data: { calls: { increment: 1 }, okCalls: { increment: ok ? 1 : 0 }, inputTokens: { increment: usage.input }, outputTokens: { increment: usage.output }, cacheReadTokens: { increment: usage.cacheRead }, cacheWriteTokens: { increment: usage.cacheWrite } } })
	]);
	if (error) throw new ConflictError(error === 'aborted' ? 'Cancelled.' : dev ? `The AI service could not answer: ${error}` : 'The AI service could not answer. Try again.');
	return new Response(answer, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store' } });
}

interface SettledRun { id: string; userId: string; model: string; status: string; free: boolean; okCalls: number; quotedCredits: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; createdAt: Date }

/**
 * Settles one run: charges it for the tokens it really used, at the provider's current rates plus the fee, rounded up. A run
 * the model never answered costs nothing. When the account cannot cover the full amount, everything it holds is taken instead,
 * so an answer is never withheld over a margin. Runs already settled are not charged again. `report` (what the browser saw)
 * only labels the run for analysis; it never changes what was charged.
 */
async function settleRun(run: SettledRun, outcome: RunOutcome, report?: { tools: Record<string, number>; steps: number }): Promise<number> {
	if (run.status !== 'running') return 0;
	// What the run owes: nothing for free runs or runs the model never answered; otherwise its real usage at current rates
	// plus the fee, falling back to the start-time estimate when the rates cannot be read.
	const model = models().find((candidate) => candidate.id === run.model);
	const rates = model && !run.free && run.okCalls > 0 ? await ratesOf(model) : null;
	const owed = run.free || run.okCalls === 0 ? 0 : rates ? settleCredits(run, rates, policy()) : run.quotedCredits;
	let settled = 0;
	await prisma.$transaction(async (tx) => {
		await tx.aiRun.update({ where: { id: run.id }, data: { status: outcome, ...(report ? { task: classifyTask(report.tools), steps: report.steps, toolCalls: Object.values(report.tools).reduce((sum, count) => sum + count, 0) } : {}), durationMs: Date.now() - run.createdAt.getTime(), finishedAt: new Date(), credits: 0, refunded: false } });
		if (owed > 0) {
			try {
				settled = owed;
				await applyCharge(tx as unknown as LedgerTx, { userId: run.userId, amount: owed, kind: 'ai', providerRef: run.id, idempotencyKey: `ai-settle:${run.id}` });
			} catch (err) {
				if (!(err instanceof CreditError) || err.code !== 'insufficient') throw err;
				// The account was spent elsewhere during the run: take what is left rather than leave the run unpaid.
				const have = (await tx.creditAccount.findUnique({ where: { userId: run.userId } }))?.balance ?? 0;
				if (have > 0) {
					settled = have;
					await applyCharge(tx as unknown as LedgerTx, { userId: run.userId, amount: have, kind: 'ai', providerRef: run.id, idempotencyKey: `ai-settle:${run.id}:partial` });
				}
			}
			await tx.aiRun.update({ where: { id: run.id }, data: { credits: settled } });
		}
	});
	return settled;
}

/** `role` is a comma-separated list ("admin,moderator"). */
const isAdmin = (role: string | null | undefined) => (role ?? '').split(',').some((entry) => entry.trim() === 'admin');

/**
 * The browser reports how a run ended and the run settles. A run whose browser never reported (tab closed) is settled by the
 * sweeper instead.
 */
export async function finishRun(user: (SessionUser & { role?: string | null }) | null, runId: string, body: unknown) {
	if (!user) throw new UnauthorizedError();
	const run = await prisma.aiRun.findUnique({ where: { id: runId } });
	if (!run || run.userId !== user.id) throw new NotFoundError();
	const input = (body ?? {}) as { outcome?: unknown; steps?: unknown; tools?: unknown };
	const outcome: RunOutcome = RUN_OUTCOMES.includes(input.outcome as RunOutcome) ? input.outcome as RunOutcome : 'error';
	const tools: Record<string, number> = {};
	if (input.tools && typeof input.tools === 'object') {
		for (const [name, count] of Object.entries(input.tools as Record<string, unknown>).slice(0, 50)) tools[name.slice(0, 60)] = Math.min(toCount(count), MAX_TOOL_CALLS_REPORTED);
	}
	const settled = await settleRun(run, outcome, { tools, steps: Math.min(toCount(input.steps), 100_000) });
	// The real cost (from the price list, not what was charged) is shown to admins and in development only.
	const model = models().find((candidate) => candidate.id === run.model);
	const costRates = model && (dev || isAdmin(user.role)) ? await ratesOf(model) : null;
	const balance = (await prisma.creditAccount.findUnique({ where: { userId: user.id } }))?.balance ?? 0;
	return { ok: true as const, settled, balance, costUsd: costRates ? runCostUsd(run, costRates) : null };
}

/**
 * A run whose browser disappeared (tab closed) never reports its outcome; this settles those runs so a used run is never left
 * uncharged. The threshold is longer than the longest run the budget allows (every model call may take up to 90 seconds), so a
 * run still in flight is never cut short. Runs the model never answered settle for free; the rest for what they used.
 */
const ABANDONED_AFTER_MS = 4 * 3_600_000;

export async function sweepAbandonedRuns(now = Date.now()): Promise<number> {
	const abandoned = await prisma.aiRun.findMany({
		where: { status: 'running', createdAt: { lt: new Date(now - ABANDONED_AFTER_MS) } },
		orderBy: { createdAt: 'asc' },
		take: 100
	});
	let settledRuns = 0;
	for (const run of abandoned) {
		try {
			if (await settleRun(run, 'stopped') > 0) settledRuns += 1;
		} catch { /* One failure must not stop the others; the run is picked up again on the next sweep. */ }
	}
	return settledRuns;
}
