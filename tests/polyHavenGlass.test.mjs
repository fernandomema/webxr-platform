import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const libRoot = new URL('../src/lib/', import.meta.url);
registerHooks({
	resolve(specifier, context, nextResolve) {
		const target = specifier.startsWith('$lib/') ? new URL(specifier.slice(5), libRoot).href : specifier;
		const resolved = (target.startsWith('.') || target.startsWith('file:')) && !/\.(ts|js|mjs|json)$/.test(target) ? `${target}.ts` : target;
		return nextResolve(resolved, context);
	}
});

const { seeThroughGlass, GLASS_OPACITY } = await import('../src/lib/server/polyHaven.ts');

test('a blended material that has no transparency of its own is made see-through', () => {
	const gltf = { materials: [{ name: 'body' }, { alphaMode: 'BLEND', pbrMetallicRoughness: {} }, { alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 0.4] } }, { alphaMode: 'BLEND' }] };
	seeThroughGlass(gltf);
	assert.equal(gltf.materials[0].pbrMetallicRoughness, undefined, 'an opaque material is left alone');
	assert.deepEqual(gltf.materials[1].pbrMetallicRoughness.baseColorFactor, [1, 1, 1, GLASS_OPACITY], 'glass becomes mostly clear');
	assert.deepEqual(gltf.materials[2].pbrMetallicRoughness.baseColorFactor, [0.5, 0.5, 0.5, 0.4], 'an opacity the model gives is kept');
	assert.deepEqual(gltf.materials[3].pbrMetallicRoughness.baseColorFactor, [1, 1, 1, GLASS_OPACITY], 'a blended material without any colour data too');
});

test('a model with no materials is fine', () => {
	assert.doesNotThrow(() => seeThroughGlass({}));
});
