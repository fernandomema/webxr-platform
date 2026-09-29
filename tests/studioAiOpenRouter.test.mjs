import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseOpenRouterModels } = await import('../src/lib/studio/ai/openrouterModels.ts');

test('OpenRouter catalogue only labels zero-priced tool-capable text models as free', () => {
	const models = parseOpenRouterModels({ data: [
		{ id: 'vendor/paid:free', name: 'Misleading suffix', supported_parameters: ['tools'], architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.001', completion: '0', request: '0' } },
		{ id: 'vendor/zero', name: 'Actually free', supported_parameters: ['tools'], architecture: { output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', request: '0' } },
		{ id: 'vendor/unknown', name: 'Unknown price', supported_parameters: ['tools'], pricing: { prompt: '0' } },
		{ id: 'vendor/no-tools', name: 'No tools', supported_parameters: [], pricing: { prompt: '0', completion: '0' } },
		{ id: 'vendor/image', name: 'Image only', supported_parameters: ['tools'], architecture: { output_modalities: ['image'] }, pricing: { prompt: '0', completion: '0' } }
	] });
	assert.deepEqual(models.map(({ id, free }) => [id, free]), [
		['vendor/zero', true],
		['vendor/paid:free', false],
		['vendor/unknown', false]
	]);
});

test('OpenRouter catalogue rejects malformed responses', () => {
	assert.throws(() => parseOpenRouterModels({ data: null }), /invalid model catalogue/);
});
