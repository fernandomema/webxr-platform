import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffAssetKind, getAssetKind, assetKindForFileName } from '../src/lib/assets/kinds/index.ts';
import { validateManifest } from '../src/lib/assets/manifest.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { importAsset } from '../src/lib/assets/importAsset.ts';
import { AssetImportError } from '../src/lib/assets/kinds/types.ts';

const text = (s) => [...s].map((c) => c.charCodeAt(0));
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const png = (w, h) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...text('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const webpX = (w, h) => new Uint8Array([...text('RIFF'), ...le32(30), ...text('WEBP'), ...text('VP8X'), ...le32(10), 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpL = (w, h) => new Uint8Array([...text('RIFF'), ...le32(30), ...text('WEBP'), ...text('VP8L'), ...le32(5), 0x2f, ...le32(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)), 0, 0, 0, 0, 0]);
const webpLossy = (w, h) => new Uint8Array([...text('RIFF'), ...le32(30), ...text('WEBP'), ...text('VP8 '), ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 63, h & 255, (h >> 8) & 63, 0, 0]);
const wav = () => new Uint8Array([...text('RIFF'), ...le32(36), ...text('WAVE'), ...text('fmt '), ...le32(16), 1, 0, 1, 0, ...le32(44100), ...le32(88200), 2, 0, 16, 0, ...text('data'), ...le32(0)]);

const kind = getAssetKind('image');

test('PNG and WebP are recognised from their first bytes, and a WAV is not mistaken for a WebP', () => {
	assert.equal(kind.sniff(png(1, 1)), 'png');
	assert.equal(kind.sniff(webpX(1, 1)), 'webp');
	assert.equal(kind.sniff(wav()), null);
	assert.equal(sniffAssetKind(wav().subarray(0, 64)).kind.type, 'audio');
	assert.equal(sniffAssetKind(webpL(4, 4).subarray(0, 64)).kind.type, 'image');
	assert.equal(kind.sniff(new Uint8Array([1, 2, 3])), null);
	assert.equal(assetKindForFileName('preview.webp')?.type, 'image');
});

test('the declared size is read from PNG and from every kind of WebP', () => {
	assert.deepEqual(kind.analyze(png(256, 128), 'a.png'), { format: 'png', width: 256, height: 128 });
	assert.deepEqual(kind.analyze(webpX(1024, 512), 'a.webp'), { format: 'webp', width: 1024, height: 512 });
	assert.deepEqual(kind.analyze(webpL(256, 256), 'a.webp'), { format: 'webp', width: 256, height: 256 });
	assert.deepEqual(kind.analyze(webpLossy(300, 200), 'a.webp'), { format: 'webp', width: 300, height: 200 });
});

test('images that are too big or unreadable are refused with a reason', () => {
	const refuses = (bytes) => assert.throws(() => kind.analyze(bytes, 'x'), (e) => e instanceof AssetImportError);
	refuses(png(5000, 10));
	refuses(png(4097, 4096));
	refuses(png(0, 10));
	refuses(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
	refuses(new Uint8Array([...text('RIFF'), ...le32(4), ...text('WEBP'), ...text('JUNK'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
	refuses(new Uint8Array(7 * 1024 * 1024).fill(1));
});

test('a manifest for an image validates, and a wrong mime type or size does not', () => {
	const manifest = { assetId: `sha256:${'a'.repeat(64)}`, type: 'image', format: 'webp', mimeType: 'image/webp', byteSize: 900, name: 'Preview', width: 256, height: 256 };
	assert.equal(validateManifest(manifest).type, 'image');
	assert.throws(() => validateManifest({ ...manifest, mimeType: 'image/png' }));
	assert.throws(() => validateManifest({ ...manifest, width: 0 }));
	assert.throws(() => validateManifest({ ...manifest, height: 9000 }));
});

test('importing an image stores it under its content hash with its size', async () => {
	const store = new MemoryAssetStore();
	const bytes = webpX(256, 256);
	const { manifest, alreadyStored } = await importAsset(bytes, 'Preview.webp', store, { type: 'image' });
	assert.equal(manifest.type, 'image');
	assert.equal(manifest.width, 256);
	assert.equal(alreadyStored, false);
	assert.deepEqual(await store.getBytes(manifest.assetId), bytes);
	assert.equal((await importAsset(bytes, 'again.webp', store, { type: 'image' })).alreadyStored, true);
});
