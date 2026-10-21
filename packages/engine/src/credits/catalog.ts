/**
 * Credits are the platform's currency. Two things are fixed here, in code both the server and the clients import: what a
 * published world may charge for (its `shop` component), and the packs people buy credits in.
 */

export const CREDIT_LIMITS = {
	/** The most a single product can cost. */
	maxPrice: 10_000,
	maxProductsPerWorld: 100,
	/** The most credits an account can hold; purchases that would pass it are refused rather than lost. */
	maxBalance: 1_000_000,
	/** The most one account can spend in 24 hours, and the most of that in a single published world. */
	spendPerDay: 20_000,
	spendPerWorldPerDay: 10_000,
	/** Asking to pay is rate-limited so a script cannot flood a player with prompts through the server. */
	challengesPerMinute: 10,
	challengeTtlMs: 60_000,
	maxNameLength: 60
} as const;

/** A product code: lowercase letters, digits, `-` and `_`. It is what scripts name and what an entitlement is stored under. */
export const SKU_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export interface ShopProduct {
	sku: string;
	name: string;
	/** In credits. */
	price: number;
	/** Whether it can be bought again once owned (a consumable). Otherwise a second purchase is refused, so nobody pays twice by accident. */
	repeatable: boolean;
}

/** The `shop` component of a slot: the products a world sells. */
export interface ShopComponentData {
	products?: unknown;
}

export function parseShopProducts(value: unknown): ShopProduct[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > CREDIT_LIMITS.maxProductsPerWorld) throw new Error('Invalid shop products');
	const seen = new Set<string>();
	return value.map((raw) => {
		const item = raw as Record<string, unknown> | null;
		if (!item || typeof item !== 'object') throw new Error('Invalid shop product');
		const { sku, name, price, repeatable } = item;
		if (typeof sku !== 'string' || !SKU_PATTERN.test(sku)) throw new Error('A product code uses lowercase letters, digits, - and _');
		if (seen.has(sku)) throw new Error(`Product ${sku} is listed twice`);
		seen.add(sku);
		if (typeof name !== 'string' || !name.trim() || name.length > CREDIT_LIMITS.maxNameLength) throw new Error(`Product ${sku} needs a name`);
		if (typeof price !== 'number' || !Number.isInteger(price) || price < 1 || price > CREDIT_LIMITS.maxPrice) throw new Error(`Product ${sku} needs a price between 1 and ${CREDIT_LIMITS.maxPrice} credits`);
		if (repeatable !== undefined && typeof repeatable !== 'boolean') throw new Error(`Product ${sku} has an invalid repeatable flag`);
		return { sku, name: name.trim(), price, repeatable: repeatable === true };
	});
}

/** Every product a world sells, from the `shop` components of its slots. Throws when one is invalid or a code is used twice. */
export function collectProducts(scene: unknown): Map<string, ShopProduct> {
	const products = new Map<string, ShopProduct>();
	if (!Array.isArray(scene)) return products;
	for (const slot of scene as Array<{ components?: Array<{ type?: string; products?: unknown }> }>) {
		for (const component of slot?.components ?? []) {
			if (component?.type !== 'shop') continue;
			for (const product of parseShopProducts(component.products)) {
				if (products.has(product.sku)) throw new Error(`Product ${product.sku} is listed twice`);
				if (products.size >= CREDIT_LIMITS.maxProductsPerWorld) throw new Error('Too many products in this world');
				products.set(product.sku, product);
			}
		}
	}
	return products;
}

/** The packs credits are bought in. `metaSku` is the item configured for it in the Meta Horizon Store developer center. */
export interface CreditPack {
	id: string;
	credits: number;
	priceCents: number;
	currency: 'usd';
	metaSku: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
	{ id: 'credits-500', credits: 500, priceCents: 499, currency: 'usd', metaSku: 'credits_500' },
	{ id: 'credits-1200', credits: 1200, priceCents: 999, currency: 'usd', metaSku: 'credits_1200' },
	{ id: 'credits-3000', credits: 3000, priceCents: 1999, currency: 'usd', metaSku: 'credits_3000' }
];

export const findPack = (id: unknown): CreditPack | undefined => CREDIT_PACKS.find((pack) => pack.id === id);
export const findPackByMetaSku = (sku: unknown): CreditPack | undefined => CREDIT_PACKS.find((pack) => pack.metaSku === sku);
