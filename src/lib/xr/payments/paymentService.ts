import type { PayResult, PurchasePromptChoice, PurchasePromptDetails } from './types';

/** What the player's client needs to ask for, confirm and top up a purchase. */
export interface PaymentDeps {
	fetch: typeof fetch;
	isSignedIn(): boolean;
	/** Shows the purchase prompt and resolves with what the player chose. Owned by the game, outside everything a script can reach. */
	prompt(details: PurchasePromptDetails): Promise<PurchasePromptChoice>;
	/** Buys credits where the platform allows it (Meta Quest). Resolves whether credits were added. */
	topUp?: { isAvailable(): boolean; buy(missing: number): Promise<boolean> };
	now?(): number;
}

interface ChallengeResponse {
	token: string;
	expiresAt: number;
	product: { sku: string; name: string; price: number };
	world: { name: string; owner: string };
	balance: number;
	owned: boolean;
}

/** After a refusal the same world cannot open a new prompt for this long, and after this many in a row it cannot until the session ends. */
const COOLDOWN_AFTER_DECLINE_MS = 5000;
const MIN_GAP_BETWEEN_PROMPTS_MS = 2000;
const MAX_DECLINES = 3;
const MAX_TOP_UPS = 2;

/**
 * The player's side of paying. A script's request ends up here, and everything that matters happens outside the script: the
 * server decides the price, the prompt shows it to the player, and only the player's choice produces a confirmation. One prompt
 * is open at a time, and a world that keeps asking after being refused is silenced, so a script cannot wear a player down into a click.
 */
export class PaymentService {
	private open = false;
	private declines = 0;
	private lastPromptAt = -Infinity;
	private blockedUntil = 0;
	private lastPublicationId: string | null = null;

	constructor(private readonly deps: PaymentDeps) {}

	private now(): number {
		return this.deps.now?.() ?? Date.now();
	}

	/** A new session or world starts with a clean slate. */
	reset(): void {
		this.declines = 0;
		this.blockedUntil = 0;
		this.lastPromptAt = -Infinity;
	}

	private async post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> | null }> {
		try {
			const response = await this.deps.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
			return { status: response.status, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
		} catch {
			return { status: 0, data: null };
		}
	}

	async buy(publicationId: string | null | undefined, sku: string, roomCode?: string | null): Promise<PayResult> {
		if (!publicationId || !this.deps.isSignedIn()) return { ok: false, reason: 'unavailable' };
		// Another world starts with a clean slate: what one world was refused does not count against the next.
		if (publicationId !== this.lastPublicationId) {
			this.lastPublicationId = publicationId;
			this.reset();
		}
		if (this.open) return { ok: false, reason: 'busy' };
		const now = this.now();
		if (this.declines >= MAX_DECLINES) return { ok: false, reason: 'declined' };
		if (now < this.blockedUntil || now - this.lastPromptAt < MIN_GAP_BETWEEN_PROMPTS_MS) return { ok: false, reason: 'busy' };
		this.open = true;
		try {
			for (let topUps = 0; ; topUps++) {
				const challenge = await this.post('/api/credits/challenge', { publicationId, sku, ...(roomCode ? { roomCode } : {}) });
				if (challenge.status === 429) return { ok: false, reason: 'busy' };
				if (challenge.status !== 200 || !challenge.data) return { ok: false, reason: challenge.status === 401 ? 'unavailable' : 'error' };
				const offer = challenge.data as unknown as ChallengeResponse;
				if (offer.owned) return { ok: false, reason: 'owned' };

				this.lastPromptAt = this.now();
				const choice = await this.deps.prompt({
					worldName: offer.world.name,
					owner: offer.world.owner,
					productName: offer.product.name,
					price: offer.product.price,
					balance: offer.balance,
					canTopUp: Boolean(this.deps.topUp?.isAvailable()) && topUps < MAX_TOP_UPS,
					timeoutMs: Math.max(1000, offer.expiresAt - this.now() - 3000)
				});
				if (choice === 'cancel') {
					this.declines += 1;
					this.blockedUntil = this.now() + COOLDOWN_AFTER_DECLINE_MS;
					return { ok: false, reason: 'declined' };
				}
				if (choice === 'topup') {
					if (!this.deps.topUp || topUps >= MAX_TOP_UPS) return { ok: false, reason: 'insufficient' };
					if (!(await this.deps.topUp.buy(Math.max(1, offer.product.price - offer.balance)))) return { ok: false, reason: 'insufficient' };
					continue;
				}
				if (offer.balance < offer.product.price) return { ok: false, reason: 'insufficient' };
				const confirmed = await this.post('/api/credits/confirm', { token: offer.token });
				if (confirmed.status === 200) {
					this.declines = 0;
					return { ok: true };
				}
				const code = confirmed.data?.code;
				if (code === 'insufficient' || code === 'owned' || code === 'limit') return { ok: false, reason: code };
				return { ok: false, reason: confirmed.status === 401 ? 'unavailable' : 'error' };
			}
		} finally {
			this.open = false;
		}
	}

	async owns(publicationId: string | null | undefined, sku: string): Promise<boolean> {
		if (!publicationId || !this.deps.isSignedIn()) return false;
		try {
			const response = await this.deps.fetch(`/api/credits/entitlements?publicationId=${encodeURIComponent(publicationId)}`, { credentials: 'same-origin' });
			if (!response.ok) return false;
			const { items } = (await response.json()) as { items?: Array<{ sku: string; quantity: number }> };
			return Boolean(items?.some((item) => item.sku === sku && item.quantity > 0));
		} catch {
			return false;
		}
	}
}
