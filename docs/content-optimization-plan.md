# Content optimization plan (`/studio/content`)

Status: planned, not started.

## Goal

When a file is selected in `/studio/content`, the detail panel offers actions that depend on its type:

| Type  | Actions                              |
| ----- | ------------------------------------ |
| Image | Convert to WebP, Compress image      |
| Model | Optimize model                       |
| Audio | Compress audio                       |

## Decisions taken

- **Result:** the action adds a new optimized asset and keeps the original untouched. Assets are content-addressed (SHA-256 of the bytes), so the optimized file has a new id and objects/worlds that use the original do not change. The user removes the original afterwards if they want the space back. Rewriting references in saved objects and worlds (local and cloud) is out of scope for the first version.
- **Where:** in the browser, so it works for "This device" without a server.
- **Models:** optimization includes meshopt compression, which requires engine changes (see below).

## Current state (relevant findings)

- Page: `src/routes/studio/content/+page.svelte`. The detail panel (`aside.detail`, `.actions`) already has Download / Copy id / Remove.
- Storage access: `src/lib/studio/content/sources.ts` (`ContentSource` has `list`, `usage`, `remove`, `bytes`; there is no `add`).
- Import path: `importAsset()` in `packages/engine/src/assets/importAsset.ts` validates, hashes and stores. The optimized bytes should go through it so limits and manifests stay consistent.
- Formats accepted today: image `png`/`webp` (max 6 MB, 4096 px side), audio `mp3`/`wav`/`ogg`, model `glb`.
- No optimization code exists. The model loaders have no meshopt or Draco support.
- `sharp` is in `package.json` but is a server-side tool; it is not used for this plan.

## Plan

### 1. Plumbing

- Add `add(bytes, name, type)` to `ContentSource`:
  - local: `importAsset(bytes, name, getLocalAssetStore(), { type })`.
  - cloud: `importAsset` into a memory store to build the manifest, then `cloudAssets.upload(manifest, bytes)`.
- New module `src/lib/studio/content/optimize.ts` with a table of actions per asset type, each `{ id, label, run(bytes, manifest) => Promise<{ bytes, name, mime }> }`, so the page only renders what the table returns for the focused type.
- In the page: a busy state per action, a before/after size toast ("1.8 MB → 420 KB"), refuse and tell the user when the result is not smaller, then `load(true)` and focus the new entry.
- Heavy work goes in a Web Worker so the studio stays responsive.

### 2. Images

- Decode with `createImageBitmap`, draw on an `OffscreenCanvas`, encode with `convertToBlob`.
- **Convert to WebP:** PNG to lossy WebP (quality about 0.85). Keep alpha. Offer only for PNG.
- **Compress image:** re-encode at lower quality; if a side is above a cap (for example 2048), downscale first. PNG compress re-encodes to WebP as well, since the canvas cannot produce a smaller PNG reliably.
- Dependencies: none.

### 3. Audio

- Decode with `AudioContext.decodeAudioData`, downmix to mono optionally, resample (for example 44.1 kHz), encode to MP3 with `lamejs` (about 128 kbps; 96 kbps for mono).
- Output format is `mp3`, which the kind already accepts.
- Dependency: `lamejs` (or `@breezystack/lamejs`), loaded lazily and only in the worker.

### 4. Models

- Dependencies: `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer` (already present in `node_modules`; add it explicitly if the engine depends on it).
- Pipeline: `dedup`, `prune`, `weld`, `quantize`, texture resize and WebP, then `meshopt` compression (`EXT_meshopt_compression`).
- **Engine change required:** register the meshopt decoder in the model loading path (Babylon `@babylonjs/loaders`, plus anywhere GLBs are parsed: `packages/engine/src/assets/glb.ts` / `glbBounds.ts` and the thumbnail capture). Without it a compressed GLB fails to load. This must be generic engine work with no game logic in it.
- `parseGlb` must keep accepting the compressed file (it reads bounds, triangles, meshes, materials, textures for the manifest); check that it does not need the decoded buffers.
- Keep original-vs-optimized triangle and material counts equal as a sanity check before storing.

### 5. Tests (node, no browser)

- `optimize.ts` action table: which actions each type gets.
- Models: run the pipeline on a small fixture GLB in node, assert it is smaller, still passes `modelKind.analyze`, and keeps triangle count.
- Audio and images: the encode steps need browser APIs, so keep the pure parts (choosing quality, dimensions, rejecting "not smaller") unit-tested and isolate the browser calls behind a small interface.
- Run the usual check and the test suite. Do not drive the browser or dev server.

## Open points

- Whether other engine consumers outside the studio (the published game runtime) must also ship the meshopt decoder. Probably yes, since optimized models will be placed in worlds.
- Quality presets (a single sensible default for now; sliders later if needed).
- Later option: "Replace in objects and worlds", rewriting references to the new id after the user confirms.
- Cloud quota: adding a copy increases usage until the original is removed; show that in the confirmation.
