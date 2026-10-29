/**
 * The models the platform offers in the Studio's AI panel, what a run of each roughly costs and how much one run may consume.
 * Runs are metered: the run is charged when it settles, for the tokens it actually used at the provider's current rates plus
 * the fee; the estimate on the Send button comes from recent runs of the same model. The budget is what keeps a run's cost
 * bounded, because it is stopped once it has used its calls or tokens.
 *
 * Prices and budgets are a first guess: the `aiRun` / `aiCall` tables record the real usage so they can be calibrated,
 * and `AI_TARIFF_VERSION` changes whenever they do.
 */
export const AI_TARIFF_VERSION = '2026-10-e';

export interface PlatformModel {
	/** The Workers AI model id. */
	id: string;
	label: string;
	/** Rough cost of one run in credits before the fee, used only when the real rates cannot be fetched. */
	credits: number;
	/** Model calls one run may make. */
	maxCalls: number;
	/** Prompt tokens, summed over all calls of a run (cached tokens included). */
	maxInputTokens: number;
	maxOutputTokens: number;
	/** What the provider charges, in USD per million tokens. Normally fetched (see `parseWorkersAiRates` / `parseOpenRouterRates`); set here only to override. */
	rates?: ModelRates;
	/** The OpenRouter id whose public price list gives this model's rates, when the model is not on Workers AI. */
	ratesFrom?: string;
}

export interface ModelRates {
	input: number;
	/** Prompt tokens served from the provider's cache. Defaults to `input`. */
	cachedInput?: number;
	/** Prompt tokens written to the cache. Defaults to `input`. */
	cacheWrite?: number;
	output: number;
}

/**
 * `@cf/…` ids run on Workers AI; any other `provider/model` id goes through Cloudflare AI Gateway (unified billing), which is
 * how the Claude models and other frontier models are reached with the platform's own token.
 */
export const DEFAULT_PLATFORM_MODELS: readonly PlatformModel[] = [
	{ id: 'anthropic/claude-sonnet-5-5', ratesFrom: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', credits: 10, maxCalls: 150, maxInputTokens: 1_500_000, maxOutputTokens: 150_000 },
	{ id: 'anthropic/claude-opus-5-5', ratesFrom: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5 · most capable', credits: 20, maxCalls: 150, maxInputTokens: 1_000_000, maxOutputTokens: 100_000 },
	{ id: 'openai/gpt-6.1-terra', ratesFrom: 'openai/gpt-6.1-terra', label: 'GPT 6.1 Terra', credits: 5, maxCalls: 150, maxInputTokens: 1_500_000, maxOutputTokens: 150_000 },
	{ id: 'openai/gpt-6.1-sol', ratesFrom: 'openai/gpt-6.1-sol', label: 'GPT 6.1 Sol', credits: 10, maxCalls: 150, maxInputTokens: 1_200_000, maxOutputTokens: 120_000 },
	{ id: 'openai/gpt-6-luna', ratesFrom: 'openai/gpt-6-luna', label: 'GPT 6 Luna · cheapest', credits: 1, maxCalls: 150, maxInputTokens: 2_000_000, maxOutputTokens: 200_000 },
	{ id: 'moonshotai/kimi-k3', ratesFrom: 'moonshotai/kimi-k3', label: 'Kimi K3', credits: 5, maxCalls: 150, maxInputTokens: 1_500_000, maxOutputTokens: 150_000 }
];

/** Whether a model id runs on Workers AI directly (otherwise it goes through AI Gateway). */
export const isWorkersAiModel = (id: string): boolean => id.startsWith('@cf/');

const positive = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;

const rate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 10_000;

/** undefined: no rates given; null: rates given but invalid. */
function parseRates(value: unknown): ModelRates | undefined | null {
	if (value === undefined) return undefined;
	const r = value as Record<string, unknown> | null;
	if (!r || !rate(r.input) || !rate(r.output) || (r.cachedInput !== undefined && !rate(r.cachedInput)) || (r.cacheWrite !== undefined && !rate(r.cacheWrite))) return null;
	return { input: r.input, output: r.output, ...(r.cachedInput !== undefined ? { cachedInput: r.cachedInput as number } : {}), ...(r.cacheWrite !== undefined ? { cacheWrite: r.cacheWrite as number } : {}) };
}

/** Reads the `PLATFORM_AI_MODELS` override; anything malformed falls back to the defaults rather than serving a half-valid list. */
export function parsePlatformModels(raw: string | undefined): PlatformModel[] {
	if (!raw?.trim()) return [...DEFAULT_PLATFORM_MODELS];
	try {
		const list = JSON.parse(raw) as unknown;
		if (!Array.isArray(list) || !list.length) return [...DEFAULT_PLATFORM_MODELS];
		const models: PlatformModel[] = [];
		for (const entry of list as Record<string, unknown>[]) {
			if (typeof entry?.id !== 'string' || !entry.id || entry.id.length > 150 || typeof entry.label !== 'string') return [...DEFAULT_PLATFORM_MODELS];
			if (!positive(entry.credits, 10_000) || !positive(entry.maxCalls, 10_000) || !positive(entry.maxInputTokens, 1e9) || !positive(entry.maxOutputTokens, 1e9)) return [...DEFAULT_PLATFORM_MODELS];
			const rates = parseRates(entry.rates);
			if (rates === null) return [...DEFAULT_PLATFORM_MODELS];
			if (entry.ratesFrom !== undefined && (typeof entry.ratesFrom !== 'string' || entry.ratesFrom.length > 150)) return [...DEFAULT_PLATFORM_MODELS];
			models.push({ id: entry.id, ...(entry.ratesFrom ? { ratesFrom: entry.ratesFrom as string } : {}), label: entry.label, credits: entry.credits, maxCalls: entry.maxCalls, maxInputTokens: entry.maxInputTokens, maxOutputTokens: entry.maxOutputTokens, ...(rates ? { rates } : {}) });
		}
		return models;
	} catch {
		return [...DEFAULT_PLATFORM_MODELS];
	}
}

export interface RunTotals { calls: number; inputTokens: number; outputTokens: number }

/** Why a run may not make another model call, or null while it is within budget. */
export function budgetExceeded(run: RunTotals, model: PlatformModel): string | null {
	if (run.calls >= model.maxCalls) return `This request reached its limit of ${model.maxCalls} model calls. Send another message to continue.`;
	if (run.inputTokens >= model.maxInputTokens || run.outputTokens >= model.maxOutputTokens) return 'This request reached its size limit. Send another message to continue.';
	return null;
}

export type AiTask = 'ask' | 'edit' | 'create' | 'complex';

/** A rough label for what a run did, from the tools the agent called, so costs can be compared per kind of task. */
export function classifyTask(tools: Record<string, number>): AiTask {
	const total = Object.values(tools).reduce((sum, count) => sum + count, 0);
	if (total > 20) return 'complex';
	if (tools.stage_subtree || tools.stage_duplicate_slot) return 'create';
	if (Object.keys(tools).some((name) => name.startsWith('stage_'))) return 'edit';
	return 'ask';
}

export const RUN_OUTCOMES = ['completed', 'stopped', 'loop', 'budget', 'error'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export interface RunUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

/** What a run cost us, in USD: uncached prompt tokens, cache reads, cache writes and output each at their own rate. */
export function runCostUsd(run: RunUsage, rates: ModelRates): number {
	const cachedRate = rates.cachedInput ?? rates.input;
	const writeRate = rates.cacheWrite ?? rates.input;
	const plain = Math.max(0, run.inputTokens - run.cacheReadTokens - run.cacheWriteTokens);
	return (plain * rates.input + run.cacheReadTokens * cachedRate + run.cacheWriteTokens * writeRate + run.outputTokens * rates.output) / 1_000_000;
}

export interface PricingPolicy {
	/** Percentage margin on cost: 0.5 charges cost + 50%. */
	feePercent: number;
	/** Flat margin added to every run, in USD. */
	feeFlatUsd: number;
	/** What one credit is worth in USD: 100 credits = 1 USD. */
	creditUsd: number;
	/** Which run is priced: 0.75 covers three runs out of four at cost + fee. */
	percentile: number;
	/** Runs needed before measured costs replace the estimate. */
	minSamples: number;
}

export const DEFAULT_PRICING: PricingPolicy = { feePercent: 0, feeFlatUsd: 1, creditUsd: 0.01, percentile: 0.75, minSamples: 30 };

/** A typical run (about ten model calls, most of the prompt served from cache), used to estimate the cost before there is data. */
export const TYPICAL_RUN: RunUsage = { inputTokens: 80_000, cacheReadTokens: 48_000, cacheWriteTokens: 8_000, outputTokens: 3_000 };

const MAX_CREDITS = 100_000;

/** What a finished run settles for, in credits: its real usage at the provider's current rates plus the fee, rounded up and capped. */
export function settleCredits(run: RunUsage, rates: ModelRates, policy: PricingPolicy = DEFAULT_PRICING): number {
	const credits = Math.ceil((runCostUsd(run, rates) * (1 + policy.feePercent) + policy.feeFlatUsd) / policy.creditUsd - 1e-9);
	return Math.min(Math.max(credits, 0), MAX_CREDITS);
}

/**
 * The price of one run in credits: the cost of the run (measured from recent completed runs, else the estimate) plus the fee,
 * rounded up. Rounding up means the fee is never eaten by rounding.
 */
export function quoteCredits(costsUsd: number[], estimateUsd: number, policy: PricingPolicy = DEFAULT_PRICING): { credits: number; calibrated: boolean } {
	const calibrated = costsUsd.length >= policy.minSamples;
	const sorted = [...costsUsd].sort((a, b) => a - b);
	const cost = calibrated ? sorted[Math.min(sorted.length - 1, Math.floor(policy.percentile * sorted.length))] : estimateUsd;
	const credits = Math.ceil((cost * (1 + policy.feePercent) + policy.feeFlatUsd) / policy.creditUsd - 1e-9);
	return { credits: Math.min(Math.max(credits, 1), MAX_CREDITS), calibrated };
}

const numberOf = (value: unknown): number | null => {
	const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/** Rates from Cloudflare's model catalogue (`ai/models/search`), which lists the price of each Workers AI model per million tokens. */
export function parseWorkersAiRates(payload: unknown, id: string): ModelRates | null {
	const list = (payload as { result?: unknown } | null)?.result;
	if (!Array.isArray(list)) return null;
	const model = list.find((entry) => (entry as { name?: unknown } | null)?.name === id) as { properties?: { property_id?: string; value?: unknown }[] } | undefined;
	const prices = model?.properties?.find((property) => property.property_id === 'price')?.value;
	if (!Array.isArray(prices)) return null;
	const byUnit = (unit: string) => numberOf((prices.find((price) => price?.unit === unit) as { price?: unknown } | undefined)?.price);
	const input = byUnit('per M input tokens');
	const output = byUnit('per M output tokens');
	if (input === null || output === null) return null;
	const cachedInput = byUnit('per M cached input tokens');
	return { input, output, ...(cachedInput !== null ? { cachedInput } : {}) };
}

/** Rates from OpenRouter's public model list (USD per token there), the reference for models Cloudflare only routes. Surcharges for very long prompts are ignored: runs stay well below them. */
export function parseOpenRouterRates(payload: unknown, id: string): ModelRates | null {
	const list = (payload as { data?: unknown } | null)?.data;
	if (!Array.isArray(list)) return null;
	const pricing = (list.find((entry) => (entry as { id?: unknown } | null)?.id === id) as { pricing?: Record<string, unknown> } | undefined)?.pricing;
	const input = numberOf(pricing?.prompt);
	const output = numberOf(pricing?.completion);
	if (input === null || output === null) return null;
	const perMillion = (value: number) => Math.round(value * 1e6 * 1e6) / 1e6;
	const cachedInput = numberOf(pricing?.input_cache_read);
	const cacheWrite = numberOf(pricing?.input_cache_write);
	return { input: perMillion(input), output: perMillion(output), ...(cachedInput !== null ? { cachedInput: perMillion(cachedInput) } : {}), ...(cacheWrite !== null ? { cacheWrite: perMillion(cacheWrite) } : {}) };
}
