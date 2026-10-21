import assert from 'node:assert/strict';
import test from 'node:test';
import { CREDIT_LIMITS, CREDIT_PACKS, collectProducts, findPack, findPackByMetaSku, parseShopProducts } from '../src/lib/credits/catalog.ts';

const slot = (id, components) => ({ id, parentId: null, name: id, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });

test('a shop lists products with a code, a name and a whole price in credits', () => {
	assert.deepEqual(parseShopProducts([{ sku: 'sword', name: ' Sword ', price: 200 }, { sku: 'potion_2', name: 'Potion', price: 5, repeatable: true }]), [
		{ sku: 'sword', name: 'Sword', price: 200, repeatable: false },
		{ sku: 'potion_2', name: 'Potion', price: 5, repeatable: true }
	]);
	assert.deepEqual(parseShopProducts(undefined), []);
});

test('products with a bad code, name, price or repeat flag are refused', () => {
	const ok = { sku: 'a', name: 'A', price: 1 };
	for (const bad of [{ sku: 'Sword' }, { sku: '' }, { sku: '-x' }, { sku: 'a'.repeat(49) }, { sku: 'a b' }, { name: '' }, { name: 'x'.repeat(61) }, { name: 5 }, { price: 0 }, { price: -1 }, { price: 1.5 }, { price: '5' }, { price: CREDIT_LIMITS.maxPrice + 1 }, { price: NaN }, { repeatable: 'yes' }]) {
		assert.throws(() => parseShopProducts([{ ...ok, ...bad }]), Error, JSON.stringify(bad));
	}
	assert.throws(() => parseShopProducts('sword'));
	assert.throws(() => parseShopProducts([null]));
	assert.throws(() => parseShopProducts([ok, ok]), /twice/);
	assert.throws(() => parseShopProducts(Array.from({ length: CREDIT_LIMITS.maxProductsPerWorld + 1 }, (_, i) => ({ sku: `p${i}`, name: 'P', price: 1 }))));
});

test('a world’s products are those of its shop components, and a code is used once', () => {
	const scene = [slot('a', [{ type: 'shop', products: [{ sku: 'sword', name: 'Sword', price: 200 }] }]), slot('b', [{ type: 'meshRenderer' }, { type: 'shop', products: [{ sku: 'axe', name: 'Axe', price: 300 }] }]), slot('c', [])];
	assert.deepEqual([...collectProducts(scene).keys()], ['sword', 'axe']);
	assert.equal(collectProducts(scene).get('axe').price, 300);
	assert.equal(collectProducts([slot('x', [])]).size, 0);
	assert.equal(collectProducts('not a scene').size, 0);
	assert.throws(() => collectProducts([...scene, slot('d', [{ type: 'shop', products: [{ sku: 'sword', name: 'Again', price: 1 }] }])]), /twice/);
	assert.throws(() => collectProducts([slot('x', [{ type: 'shop', products: [{ sku: 'x', name: 'X', price: 0 }] }])]));
});

test('the packs have unique ids and store items, and can be found by either', () => {
	assert.equal(new Set(CREDIT_PACKS.map((p) => p.id)).size, CREDIT_PACKS.length);
	assert.equal(new Set(CREDIT_PACKS.map((p) => p.metaSku)).size, CREDIT_PACKS.length);
	for (const pack of CREDIT_PACKS) {
		assert.ok(Number.isInteger(pack.credits) && pack.credits > 0 && Number.isInteger(pack.priceCents) && pack.priceCents > 0);
		assert.equal(findPack(pack.id), pack);
		assert.equal(findPackByMetaSku(pack.metaSku), pack);
	}
	assert.equal(findPack('nope'), undefined);
	assert.ok(CREDIT_PACKS.every((pack) => pack.credits <= CREDIT_LIMITS.maxBalance));
});
