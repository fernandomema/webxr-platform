import type { MetaPackInfo, MetaPayments } from './metaPayments';

export interface AtmPackView {
	id: string;
	credits: number;
	/** What the store says it costs when it can be bought here, otherwise our own list price. */
	priceLabel: string;
	metaSku: string;
}

export interface AtmState {
	phase: 'loading' | 'ready' | 'signed-out' | 'error';
	balance: number;
	packs: AtmPackView[];
	/** Credits can be bought without leaving the game (the Meta store is there). */
	canBuyHere: boolean;
	message: string;
	/** The pack being paid for, while a payment is under way. */
	busy: string | null;
}

interface Summary {
	balance: number;
	packs: Array<{ id: string; credits: number; priceCents: number; currency: string; metaSku: string }>;
	providers: Array<{ id: string }>;
}

export interface AtmDeps {
	fetch: typeof fetch;
	meta: Pick<MetaPayments, 'isAvailable' | 'open' | 'details' | 'buy' | 'recover'>;
	isSignedIn(): boolean;
}

const money = (cents: number, currency: string): string => {
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
	}
};

/**
 * What the ATM window shows and does, apart from how it is drawn. It reads the balance from the server, asks the store (when
 * there is one) for its prices, finishes purchases that were paid and never credited, and buys a pack when the player presses it.
 * Nothing here is reachable from a world: the window is the game's.
 */
export function createAtmController(deps: AtmDeps) {
	let state: AtmState = { phase: 'loading', balance: 0, packs: [], canBuyHere: false, message: '', busy: null };
	const listeners = new Set<(next: AtmState) => void>();
	const set = (patch: Partial<AtmState>) => {
		state = { ...state, ...patch };
		for (const listener of listeners) listener(state);
	};

	async function readSummary(): Promise<Summary | null> {
		try {
			const response = await deps.fetch('/api/credits', { credentials: 'same-origin' });
			return response.ok ? ((await response.json()) as Summary) : null;
		} catch {
			return null;
		}
	}

	const toMeta = (packs: Summary['packs']): MetaPackInfo[] => packs.map(({ id, credits, metaSku }) => ({ id, credits, metaSku }));

	async function load(): Promise<void> {
		if (!deps.isSignedIn()) return set({ phase: 'signed-out', message: '', busy: null });
		let summary = await readSummary();
		if (!summary) return set({ phase: 'error', message: 'Could not reach your account. Try again in a moment.', busy: null });
		const canBuyHere = deps.meta.isAvailable() && summary.providers.some((provider) => provider.id === 'meta') && (await deps.meta.open()) !== null;
		let message = '';
		let details = new Map<string, { price: string }>();
		if (canBuyHere) {
			if ((await deps.meta.recover(toMeta(summary.packs))) > 0) {
				summary = (await readSummary()) ?? summary;
				message = 'Credits from an earlier purchase were added.';
			}
			details = await deps.meta.details(summary.packs.map((pack) => pack.metaSku));
		}
		set({
			phase: 'ready',
			balance: summary.balance,
			canBuyHere,
			message,
			busy: null,
			packs: summary.packs.map((pack) => ({ id: pack.id, credits: pack.credits, metaSku: pack.metaSku, priceLabel: (canBuyHere && details.get(pack.metaSku)?.price) || money(pack.priceCents, pack.currency) }))
		});
	}

	return {
		get state(): AtmState { return state; },
		subscribe(listener: (next: AtmState) => void): () => void {
			listeners.add(listener);
			listener(state);
			return () => listeners.delete(listener);
		},
		/** Called each time the window opens. */
		async open(): Promise<void> {
			set({ phase: 'loading', message: '', busy: null });
			await load();
		},
		async buy(packId: string): Promise<void> {
			const pack = state.packs.find((candidate) => candidate.id === packId);
			if (!pack || !state.canBuyHere || state.busy) return;
			set({ busy: pack.id, message: 'Confirm the payment in the store window…' });
			const result = await deps.meta.buy({ id: pack.id, credits: pack.credits, metaSku: pack.metaSku });
			const summary = await readSummary();
			set({
				busy: null,
				...(summary ? { balance: summary.balance } : {}),
				message: result.status === 'credited' ? `${pack.credits.toLocaleString()} credits added.` : result.status === 'cancelled' ? '' : result.message
			});
		}
	};
}

export type AtmController = ReturnType<typeof createAtmController>;
