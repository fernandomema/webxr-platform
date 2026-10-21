import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectProducts } from '../packages/engine/src/credits/catalog.ts';
import { parseAppName, parseAppOrigins, parseAppProducts, shopScene } from '../src/lib/server/appInput.ts';
import { BadRequestError } from '../src/lib/server/errors.ts';

test('an app’s sites are exact origins: https anywhere, http only on this machine, nothing but the site', () => {
	assert.deepEqual(parseAppOrigins(['https://mygame.example', 'https://mygame.example/', 'http://localhost:5174']), ['https://mygame.example', 'http://localhost:5174']);
	assert.deepEqual(parseAppOrigins([]), []);
	for (const bad of ['http://mygame.example', 'https://*.example', 'https://mygame.example/play', 'https://mygame.example?x=1', 'mygame.example', 'https://u:p@mygame.example', 5]) {
		assert.throws(() => parseAppOrigins([bad]), BadRequestError, String(bad));
	}
	assert.throws(() => parseAppOrigins(Array.from({ length: 11 }, (_, i) => `https://a${i}.example`)), BadRequestError);
	assert.throws(() => parseAppOrigins('https://mygame.example'), BadRequestError);
});

test('an app needs a name', () => {
	assert.equal(parseAppName('  My game '), 'My game');
	for (const bad of ['', '   ', 'x'.repeat(81), undefined]) assert.throws(() => parseAppName(bad), BadRequestError);
});

test('an app’s products are stored as the shop of a scene, which is where the credit code reads prices from', () => {
	const products = parseAppProducts([{ sku: 'sword', name: 'Sword', price: 300 }, { sku: 'coins', name: 'Coins', price: 50, repeatable: true }]);
	const prices = collectProducts(shopScene(products));
	assert.deepEqual([...prices.keys()], ['sword', 'coins']);
	assert.equal(prices.get('sword').price, 300);
	assert.equal(prices.get('coins').repeatable, true);
	assert.equal(collectProducts(shopScene(parseAppProducts(undefined))).size, 0);
	assert.throws(() => parseAppProducts([{ sku: 'Bad Code', name: 'x', price: 1 }]), BadRequestError);
	assert.throws(() => parseAppProducts([{ sku: 'a', name: 'A', price: 1 }, { sku: 'a', name: 'B', price: 2 }]), BadRequestError);
	assert.throws(() => parseAppProducts([{ sku: 'a', name: 'A', price: 0 }]), BadRequestError);
});
