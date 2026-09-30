import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/assets/kinds/index.ts';
import { assetKindForFileName, sniffAssetKind } from '../src/lib/assets/kinds/index.ts';
import { validateManifest } from '../src/lib/assets/manifest.ts';
import { importAsset } from '../src/lib/assets/importAsset.ts';
import { resolveAsset } from '../src/lib/assets/resolve.ts';
import { MemoryAssetStore } from '../src/lib/assets/store.ts';
import { assetIdOf } from '../src/lib/assets/hash.ts';
import { assetSource, collectAssetIds, migrateSlotTree, normalizeSourceRef, urlSource } from '../src/lib/assets/ref.ts';
import { buildGlb } from './helpers/glb.mjs';

const slot = (components) => ({ id: 's', parentId: null, name: 's', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });

/** A minimal PCM wav: 1 s of silence, mono, 8 kHz, 8-bit. */
function wav(seconds = 1) {
  const data = new Uint8Array(8000 * seconds).fill(128);
  const out = new Uint8Array(44 + data.length);
  const view = new DataView(out.buffer);
  const text = (at, s) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + data.length, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, data.length, true); out.set(data, 44);
  return out;
}

/** A tiny MPEG-1 Layer III stream: one 128 kbps / 44.1 kHz stereo frame header repeated. */
function mp3(bytes = 16000) {
  const out = new Uint8Array(bytes);
  out.set([0xff, 0xfb, 0x90, 0x00], 0);
  return out;
}

test('each format is recognised from its first bytes and routed by extension', () => {
  assert.equal(sniffAssetKind(wav()).format, 'wav');
  assert.equal(sniffAssetKind(mp3()).format, 'mp3');
  assert.equal(sniffAssetKind(new TextEncoder().encode('OggS\0\x02rest')).format, 'ogg');
  assert.equal(sniffAssetKind(buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })).kind.type, 'model');
  assert.equal(sniffAssetKind(new Uint8Array(32)), null);
  assert.equal(assetKindForFileName('Song.MP3').type, 'audio');
  assert.equal(assetKindForFileName('chair.glb').type, 'model');
  assert.equal(assetKindForFileName('notes.txt'), undefined);
});

test('audio imports with measured metadata and is stored by content', async () => {
  const store = new MemoryAssetStore();
  const first = await importAsset(wav(2), 'My_beep-loop.wav', store);
  assert.equal(first.alreadyStored, false);
  assert.deepEqual(
    { type: first.manifest.type, format: first.manifest.format, mimeType: first.manifest.mimeType, name: first.manifest.name, channels: first.manifest.channels, sampleRate: first.manifest.sampleRate, duration: first.manifest.duration },
    { type: 'audio', format: 'wav', mimeType: 'audio/wav', name: 'My beep loop', channels: 1, sampleRate: 8000, duration: 2 }
  );
  assert.equal((await importAsset(wav(2), 'other.wav', store)).alreadyStored, true);
  const m = await importAsset(mp3(), 'a.mp3', store);
  assert.equal(m.manifest.format, 'mp3');
  assert.equal(m.manifest.sampleRate, 44100);
  assert.ok(Math.abs(m.manifest.duration - 1) < 0.05);
});

test('unsupported and mismatched files are refused with a reason', async () => {
  const store = new MemoryAssetStore();
  await assert.rejects(() => importAsset(new TextEncoder().encode('hello world, not audio'), 'x.mp3', store), /not supported/);
  await assert.rejects(() => importAsset(wav(), 'x.wav', store, { type: 'model' }), /not a \.glb/);
  assert.equal((await store.list()).length, 0);
});

test('the server validates audio manifests by kind and rejects unknown kinds', async () => {
  const store = new MemoryAssetStore();
  const { manifest } = await importAsset(wav(), 'a.wav', store);
  assert.equal(validateManifest(manifest).name, 'a');
  assert.throws(() => validateManifest({ ...manifest, type: 'texture' }), /Unsupported asset type/);
  assert.throws(() => validateManifest({ ...manifest, mimeType: 'audio/mpeg' }), /format/);
  assert.throws(() => validateManifest({ ...manifest, sampleRate: 1 }), /sample rate/);
  assert.throws(() => validateManifest({ ...manifest, duration: -1 }), /duration/);
  // models keep working through the same path
  const glb = await importAsset(buildGlb({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }), 'm.glb', store);
  assert.equal(validateManifest(glb.manifest).type, 'model');
});

test('audio bytes from a remote source are checked against their hash and kind', async () => {
  const bytes = wav();
  const id = await assetIdOf(bytes);
  const store = new MemoryAssetStore();
  const good = { name: 'cloud', resolve: async () => bytes };
  assert.equal((await resolveAsset(id, [good], store)).ok, true);
  assert.equal((await store.getManifest(id)).type, 'audio');

  const other = new MemoryAssetStore();
  const lying = { name: 'liar', resolve: async () => wav(2) };
  assert.equal((await resolveAsset(id, [lying], other)).ok, false);
  const junk = new TextEncoder().encode('not audio at all, just text');
  const junkId = await assetIdOf(junk);
  const result = await resolveAsset(junkId, [{ name: 'x', resolve: async () => junk }], new MemoryAssetStore());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
});

test('audio sources are read in every stored form and collected as assets', async () => {
  const id = await assetIdOf(wav());
  assert.deepEqual(normalizeSourceRef(undefined, 'https://x.test/a.mp3'), urlSource('https://x.test/a.mp3'));
  assert.deepEqual(normalizeSourceRef(assetSource(id)), assetSource(id));
  assert.deepEqual(normalizeSourceRef({ kind: 'asset', assetId: 'sha256:short' }), urlSource(''));

  const legacy = [slot([{ type: 'audioPlayer', url: 'https://x.test/a.mp3' }])];
  const [migrated] = migrateSlotTree(legacy);
  assert.deepEqual(migrated.components[0], { type: 'audioPlayer', source: urlSource('https://x.test/a.mp3') });
  assert.equal(collectAssetIds(legacy).size, 0);

  const scene = [
    slot([{ type: 'audioPlayer', source: assetSource(id) }]),
    slot([{ type: 'worldPortal', world: { scene: [slot([{ type: 'audioPlayer', source: assetSource(id) }])] } }])
  ];
  assert.deepEqual([...collectAssetIds(scene)], [id]);
});
