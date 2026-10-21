import { parseShopProducts, type ShopProduct } from '@kithin/engine/credits/catalog';
import type { SlotTree } from '@kithin/engine/ecs/types';
import { BadRequestError } from './errors.ts';

export const APP_LIMITS = { maxNameLength: 80, maxOrigins: 10, maxOriginLength: 200 } as const;

export function parseAppName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.trim().length > APP_LIMITS.maxNameLength) throw new BadRequestError(`Give the app a name of up to ${APP_LIMITS.maxNameLength} characters`);
	return value.trim();
}

/**
 * The sites an app runs on, as exact origins (`https://mygame.example`, `http://localhost:5174`). No wildcards and no paths: whoever
 * owns an app can only allow the sites they list, never a whole domain.
 */
export function parseAppOrigins(value: unknown): string[] {
	if (!Array.isArray(value) || value.length > APP_LIMITS.maxOrigins) throw new BadRequestError(`List up to ${APP_LIMITS.maxOrigins} sites`);
	const origins = new Set<string>();
	for (const raw of value) {
		if (typeof raw !== 'string' || raw.length > APP_LIMITS.maxOriginLength) throw new BadRequestError('Invalid site');
		let url: URL;
		try { url = new URL(raw.trim()); } catch { throw new BadRequestError(`"${raw}" is not a site address`); }
		if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(url.hostname)) throw new BadRequestError(`"${raw}" must name one site, without wildcards`);
		const plain = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
		if (url.protocol !== 'https:' && !plain) throw new BadRequestError(`"${raw}" must use https (http is only for localhost)`);
		if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new BadRequestError(`"${raw}" must be just a site, such as ${url.origin}`);
		origins.add(url.origin);
	}
	return [...origins];
}

export function parseAppProducts(value: unknown): ShopProduct[] {
	try { return parseShopProducts(value ?? []); } catch (error) { throw new BadRequestError(error instanceof Error ? error.message : 'Invalid products'); }
}

/** The scene an app's one revision holds: a single slot with the shop, which is where the credit code reads the prices from. */
export function shopScene(products: ShopProduct[]): SlotTree {
	return [{
		id: 'shop', parentId: null, name: 'Shop', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
		components: [{ type: 'shop', products }]
	}] as unknown as SlotTree;
}
