/**
 * Buying credits inside the headset with Meta's in-app payments, following Meta's guide for WebXR PWAs
 * (developers.meta.com/horizon/documentation/web/ps-iap): the Digital Goods API, which an app installed from the Horizon Store
 * can use.
 *
 *  1. `getDigitalGoodsService('https://quest.meta.com/billing')` gives the store service (it rejects anywhere else).
 *  2. `getDetails([sku])` returns the store's own title and price, which are what the player is shown.
 *  3. A `PaymentRequest` for `{ supportedMethods: <billing url>, data: { sku } }` opens Meta's payment sheet. The token it returns is
 *     recorded before `complete()` is called, because the platform blocks input until the response is completed.
 *  4. `listPurchases()` returns the consumable purchases that were paid but not consumed yet: a payment whose credits never
 *     arrived (the app closed, the network dropped) is finished from there the next time the machine is used.
 *  5. `getLoggedInUserId()` is the player's app-scoped Meta id, which the server needs to verify the purchase with Meta.
 *
 * The device only ever hands the server a receipt. The server asks Meta whether the player really owns the item, consumes it
 * (an unconsumed consumable is refunded by Meta after three days) and only then credits anything (see server/payments/meta.ts).
 */
const BILLING_URL = 'https://quest.meta.com/billing';

export interface DigitalGoodsServiceLike {
	getDetails(skus: string[]): Promise<Array<{ itemId: string; title?: string; price?: { currency: string; value: string } }>>;
	listPurchases(): Promise<Array<{ itemId: string; purchaseToken: string }>>;
	getLoggedInUserId?(): Promise<string | number | null | undefined>;
}

interface PaymentResponseLike {
	details: { purchaseToken?: string };
	complete(result?: string): Promise<void>;
}

export interface MetaPackInfo {
	id: string;
	credits: number;
	metaSku: string;
}

/** What the store says an item costs, ready to show. */
export interface StoreDetail {
	title: string;
	price: string;
}

export type MetaBuyResult = { status: 'credited' } | { status: 'cancelled' } | { status: 'failed'; message: string };

export interface MetaPaymentsDeps {
	fetch: typeof fetch;
	/** Overridable for tests; defaults to the page's own. */
	win?: {
		getDigitalGoodsService?: (url: string) => Promise<DigitalGoodsServiceLike>;
		PaymentRequest?: new (methods: unknown[], details: unknown) => { show(): Promise<PaymentResponseLike> };
	};
}

const formatPrice = (price: { currency: string; value: string } | undefined): string => {
	if (!price) return '';
	const amount = Number(price.value);
	try {
		return Number.isFinite(amount) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(amount) : `${price.value} ${price.currency}`;
	} catch {
		return `${price.value} ${price.currency}`;
	}
};

/** "0" means Meta has no logged-in player to give. */
const cleanUserId = (value: unknown): string | null => {
	const text = value === null || value === undefined ? '' : String(value);
	return /^[1-9]\d{0,23}$/.test(text) ? text : null;
};

export function createMetaPayments(deps: MetaPaymentsDeps) {
	const win = (deps.win ?? (typeof window === 'undefined' ? {} : window)) as NonNullable<MetaPaymentsDeps['win']>;
	let service: Promise<DigitalGoodsServiceLike | null> | null = null;

	const postReceipt = async (sku: string, purchaseToken: string, metaUserId: string): Promise<boolean> => {
		try {
			const response = await deps.fetch('/api/credits/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'meta', receipt: { sku, purchaseToken, metaUserId } }), credentials: 'same-origin' });
			return response.ok;
		} catch {
			return false;
		}
	};

	const api = {
		/** Whether this browser has the pieces at all. Whether the store answers is `open()`. */
		isAvailable: (): boolean => typeof win.getDigitalGoodsService === 'function' && typeof win.PaymentRequest === 'function',

		/** The store service, or `null` when this is not the Horizon Store build (the service rejects there). Asked once. */
		open(): Promise<DigitalGoodsServiceLike | null> {
			if (!api.isAvailable()) return Promise.resolve(null);
			service ??= win.getDigitalGoodsService!(BILLING_URL).then((opened) => opened, () => null);
			return service;
		},

		/** The store's own title and price for each item (an item the store does not list is left out). */
		async details(skus: string[]): Promise<Map<string, StoreDetail>> {
			const found = new Map<string, StoreDetail>();
			const opened = await api.open();
			if (!opened || skus.length === 0) return found;
			const add = (items: Awaited<ReturnType<DigitalGoodsServiceLike['getDetails']>>) => { for (const item of items) found.set(item.itemId, { title: item.title ?? item.itemId, price: formatPrice(item.price) }); };
			try {
				add(await opened.getDetails(skus));
			} catch {
				// The store may refuse the whole list because one item is not in it (not created yet): ask for each, so the ones it has are still found.
				for (const sku of skus) {
					try { add(await opened.getDetails([sku])); } catch { /* not in the store */ }
				}
			}
			return found;
		},

		/** Pays for one pack with Meta's payment sheet. Resolves once the server has credited it, or with why not. */
		async buy(pack: MetaPackInfo): Promise<MetaBuyResult> {
			const opened = await api.open();
			if (!opened || !win.PaymentRequest) return { status: 'failed', message: 'Meta payments are not available here.' };
			// Where it stopped, for the message and the console: the store's errors say little by themselves.
			let stage = 'account';
			try {
				// The player's Meta id first: nothing is charged that the server could not verify afterwards.
				const metaUserId = cleanUserId(await opened.getLoggedInUserId?.());
				if (!metaUserId) return { status: 'failed', message: 'Allow this app to see your Meta account to buy credits.' };
				stage = 'store';
				if (!(await opened.getDetails([pack.metaSku])).some((item) => item.itemId === pack.metaSku)) return { status: 'failed', message: 'The store does not list this item.' };
				stage = 'payment sheet';
				const request = new win.PaymentRequest([{ supportedMethods: BILLING_URL, data: { sku: pack.metaSku } }], { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } });
				let response: PaymentResponseLike;
				try {
					response = await request.show();
				} catch (error) {
					const name = (error as { name?: string } | null)?.name;
					if (name === 'AbortError' || name === 'NotAllowedError') return { status: 'cancelled' };
					console.warn('[meta-payments] the payment sheet failed', error);
					return { status: 'failed', message: `The payment could not be started${name ? ` (${name})` : ''}.` };
				}
				stage = 'receipt';
				const purchaseToken = response.details.purchaseToken;
				if (!purchaseToken) {
					await response.complete('fail');
					return { status: 'failed', message: 'The store did not return a receipt.' };
				}
				// The token is in hand: completing frees the headset's input. Crediting follows, and `recover` finishes it if it does not.
				await response.complete('success');
				return (await postReceipt(pack.metaSku, purchaseToken, metaUserId))
					? { status: 'credited' }
					: { status: 'failed', message: 'Your payment went through. The credits will arrive the next time you use the ATM.' };
			} catch (error) {
				const { name, message } = (error ?? {}) as { name?: string; message?: string };
				console.warn(`[meta-payments] failed at the ${stage}`, error);
				// The page is not running inside the app the store installed (a browser tab, a sideloaded copy): nothing here can fix that.
				if (typeof message === 'string' && /client app unavailable/i.test(message)) return { status: 'failed', message: 'Buying only works in the app installed from the Horizon Store, not in a browser tab or a sideloaded copy.' };
				// The store's own words are the only clue to what it dislikes, so they are shown (shortened).
				const said = typeof message === 'string' && message ? `: ${message.slice(0, 120)}` : '';
				return { status: 'failed', message: `The payment failed at the ${stage}${name ? ` (${name})` : ''}${said}${stage === 'store' ? ` [${pack.metaSku}]` : ''}` };
			}
		},

		/** Finishes the purchases that were paid and never credited. Resolves how many packs it credited. */
		async recover(packs: MetaPackInfo[]): Promise<number> {
			const opened = await api.open();
			if (!opened) return 0;
			try {
				const metaUserId = cleanUserId(await opened.getLoggedInUserId?.());
				if (!metaUserId) return 0;
				let credited = 0;
				for (const purchase of await opened.listPurchases()) {
					if (!packs.some((pack) => pack.metaSku === purchase.itemId) || !purchase.purchaseToken) continue;
					if (await postReceipt(purchase.itemId, purchase.purchaseToken, metaUserId)) credited++;
				}
				return credited;
			} catch {
				return 0;
			}
		},

		/** The shape the purchase prompt uses to offer "Add credits": the smallest pack that covers what is missing. */
		topUp(packs: () => Promise<MetaPackInfo[]>) {
			return {
				isAvailable: () => api.isAvailable(),
				async buy(missing: number): Promise<boolean> {
					const pack = (await packs()).filter((candidate) => candidate.credits >= missing).sort((a, b) => a.credits - b.credits)[0];
					return pack ? (await api.buy(pack)).status === 'credited' : false;
				}
			};
		}
	};
	return api;
}

export type MetaPayments = ReturnType<typeof createMetaPayments>;
