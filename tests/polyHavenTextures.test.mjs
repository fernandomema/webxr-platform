import assert from 'node:assert/strict';
import test from 'node:test';
import { isTextureId, isTextureUrl, textureFileFor } from '../src/lib/server/polyHavenTextures.ts';

const file = (url, size = 1000) => ({ url, size });
const files = {
	Diffuse: { '1k': { jpg: file('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick/brick_diff_1k.jpg'), png: file('https://dl.polyhaven.org/x.png') }, '2k': { jpg: file('https://dl.polyhaven.org/2k.jpg') } },
	nor_gl: { '1k': { png: file('https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/brick/brick_nor_gl_1k.png') } }
};

test('each map takes the smallest size and the jpg before the png', () => {
	assert.match(textureFileFor(files, 'albedo').url, /brick_diff_1k\.jpg$/);
	assert.match(textureFileFor(files, 'normal').url, /brick_nor_gl_1k\.png$/);
});

test('a texture without a map says so instead of guessing', () => {
	assert.equal(textureFileFor(files, 'arm'), null);
	assert.equal(textureFileFor(null, 'albedo'), null);
	assert.equal(textureFileFor({ Diffuse: { '1k': { jpg: { url: 'x', size: 0 } } } }, 'albedo'), null);
});

test('only Poly Haven\'s texture folder over https can be downloaded', () => {
	assert.equal(isTextureUrl('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/a/a.jpg'), true);
	for (const bad of ['http://dl.polyhaven.org/file/ph-assets/Textures/a.jpg', 'https://evil.example/file/ph-assets/Textures/a.jpg', 'https://dl.polyhaven.org/file/ph-assets/Models/a.glb', 'https://user:pw@dl.polyhaven.org/file/ph-assets/Textures/a.jpg', '//dl.polyhaven.org/x', 42, null]) assert.equal(isTextureUrl(bad), false, String(bad));
});

test('texture ids are plain slugs', () => {
	assert.equal(isTextureId('brick_wall_002'), true);
	for (const bad of ['', '../x', 'a b', 'a/b', 'x'.repeat(91), 5]) assert.equal(isTextureId(bad), false, String(bad));
});

test('a texture offers one variant per size that has a colour or a normal map, with only the files it really has', async () => {
	const { textureVariants } = await import('../src/lib/server/polyHavenTextures.ts');
	const at = (res, ext) => ({ url: `https://dl.polyhaven.org/file/ph-assets/Textures/${ext}/${res}/a/a.${ext}`, size: 1000 });
	const list = { Diffuse: { '1k': { jpg: at('1k', 'jpg') }, '2k': { jpg: at('2k', 'jpg') } }, nor_gl: { '1k': { png: at('1k', 'png') } }, arm: { '2k': { jpg: at('2k', 'jpg') } } };
	const variants = textureVariants(list);
	assert.deepEqual(variants.map((variant) => variant.resolution), ['1k', '2k']);
	assert.deepEqual(variants[0].maps.map((map) => map.role), ['albedo', 'normal']);
	assert.deepEqual(variants[1].maps.map((map) => map.role), ['albedo', 'arm']);
	assert.deepEqual(textureVariants({ arm: { '1k': { jpg: at('1k', 'jpg') } } }), [], 'a texture with only an ARM map is not usable');
	assert.equal(textureVariants({ Diffuse: { '1k': { jpg: { url: 'https://evil.example/x.jpg', size: 10 } } } }).length, 0, 'files outside Poly Haven\'s folder are left out');
});
