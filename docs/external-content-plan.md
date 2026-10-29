# External content library (`Library`)

Status: phases 0 to 4 built (see "As built" at the end for what was left out). Not yet tried in a browser or against the live services.

## Goal

One system to search and bring in assets that live outside the platform: PBR materials and textures, 3D models, and later sounds, HDRIs and pictures. It replaces the Poly Haven code that today exists in three separate places, and it is the base for:

- an **Explore** tab next to AI in the Studio's right panel, to explore and import models (and materials) from outside sources;
- a **Browse online** button with a modal wherever the editor asks for a material or a model;
- the AI tools (today `search_textures` / `import_texture`), which become a thin client of the same system;
- any source added later (ambientCG, Sketchfab, Kenney, a studio's own server…) by writing one adapter, with no change to the UI, the AI or the importers.

## What exists today (to be unified)

| Piece | Where | Becomes |
| --- | --- | --- |
| Poly Haven models: search, glTF to GLB packing | `src/lib/server/polyHaven.ts`, `/api/polyhaven/models` | the Poly Haven adapter, `model` kind |
| Poly Haven textures: search, map download | `polyHaven.ts`, `polyHavenTextures.ts`, `/api/polyhaven/textures/*` | the Poly Haven adapter, `material` kind |
| Rules for reading Poly Haven (shared with a world script) | `POLY_HAVEN_LOGIC_SOURCE` in `polyHeavenMaterials.ts` | stays (a world's code block cannot import modules); the adapter reuses it |
| AI: search, download, convert, import | `src/lib/studio/ai/textures.ts` | the material importer + generic AI tools |
| WebP conversion | `src/lib/studio/content/imageOptimize.ts` | reused as is by the importers |
| Scripts importing a Poly Haven model into a world | `onImportPolyHavenModel` in `packages/engine/src/xr/engine.ts` | a generic `onImportLibraryAsset` hook |

## Design decisions

### One contract, not two systems

The two use cases (textures/PBR and models) share the same hard parts: searching, licences, thumbnails, variants, downloading under limits, caching, provenance. What differs is what happens **after** the download. So there is **one source contract** and **one importer per asset kind**:

```hs
AssetSource (search, detail, files)     one per external service
        |
   Library registry                     the sources that are enabled
        |
AssetImporter (per kind)                model -> GLB asset, material -> image assets + material values,
                                        audio -> audio asset, ... (new kinds add an importer, not a source)
```

"The textures system" and "the models system" are then two **views** over the same registry (`kind: 'material'` and `kind: 'model'`), which is what the UI and the AI tools filter on. Nothing in the contract mentions textures or models by name except through `kind`.

### All remote access is server side

Browsers cannot reach most of these services (no CORS, keys, rate limits), and the platform must stay in control of what it downloads. So the browser only talks to generic routes of ours; adapters run on the server. This also gives one place for caching, rate limiting, size caps and the host allowlist.

### Where the code lives

- `packages/engine/src/library/` (generic, no game logic, reusable by a game): the types, `parseAssetRef` / `formatAssetRef`, license helpers, `pickVariant`.
- `src/lib/server/library/` (the app): the registry, the `createHttpSource` helper, the adapters (`polyhaven.ts`, `shep.ts`, `grab3d.ts`, `lazytextures.ts`, `freetouse.ts`), the routes' logic.
- `src/lib/studio/library/` (the Studio): the importers (they need the Studio's asset stores), the browser components, the Studio state.

## The contract

```ts
type AssetKind = 'model' | 'material' | 'texture' | 'hdri' | 'audio' | 'image' | 'font' | 'pack';

interface License { name: string; url?: string; commercialUse: boolean | 'unknown'; attributionRequired: boolean | 'unknown' }

/** "polyhaven:brick_wall_002": the source id and the id inside that source. The only id the rest of the app handles. */
type AssetRef = `${string}:${string}`;

interface AssetSource {
	readonly info: SourceInfo;
	search(query: SearchQuery, signal?: AbortSignal): Promise<SearchPage>;
	detail(nativeId: string, signal?: AbortSignal): Promise<AssetDetail>;
	/** Optional: sources that need more than "GET the file url" (a signed link, a zip to open). */
	open?(file: RemoteFile, signal?: AbortSignal): Promise<Response>;
}

interface SourceInfo {
	id: string;                      // "polyhaven", "shep"
	name: string;
	homepage: string;
	kinds: AssetKind[];              // what it can serve
	access: 'api' | 'link';          // link: can search, but files must be taken on its own site
	allowedHosts: string[];          // the only hosts its files may come from
	needsKey?: boolean;
	covers?: string[];               // an aggregator lists the sources it already includes (see Aggregators)
	defaultLicense?: License;
}

interface SearchQuery { text: string; kind: AssetKind; cursor?: string; limit?: number; filters?: { freeOnly?: boolean; commercialOnly?: boolean; category?: string; maxPolyCount?: number } }
interface SearchPage { items: AssetSummary[]; next: string | null; total?: number }   // opaque cursor: a page number, an offset or a token

interface AssetSummary {
	ref: AssetRef; kind: AssetKind; title: string; thumbnailUrl?: string; author?: string;
	license: License; tags: string[]; categories?: string[];
	sourceUrl: string;               // the asset's page, always shown ("View on …")
	downloadable: boolean;
	facts?: { polyCount?: number; animated?: boolean; rigged?: boolean; realWorldSize?: number; maps?: string[]; resolutions?: string[] };
}

interface AssetDetail extends AssetSummary { description?: string; variants: Variant[] }
/** A way to take the asset: a resolution and a format. A model is one variant per format/size; a material one per resolution. */
interface Variant { id: string; label: string; resolution?: string; format: string; totalBytes?: number; files: RemoteFile[] }
/** `role` says what a file is for, so importers do not guess from file names. */
interface RemoteFile { role: FileRole; url: string; format: string; sizeBytes?: number; includes?: { path: string; url: string; sizeBytes?: number }[] }
type FileRole = 'model' | 'albedo' | 'normal' | 'roughness' | 'metallic' | 'ao' | 'arm' | 'height' | 'opacity' | 'emissive' | 'hdri' | 'audio' | 'image' | 'archive' | 'other';
```

Why it is not limited to the first two uses: `kind` and `FileRole` are open lists that only grow; a source says what it serves in `kinds`; an unknown kind simply has no importer yet (it can still be browsed and linked). `facts` is optional data for the card, never required by the contract.

### Provided to adapter authors

- `createHttpSource(...)`: fetch with timeout, user agent, response size cap, in-flight request merging, an in-memory TTL cache and a per-source rate limiter, so an adapter is mostly *mapping JSON to the contract*.
- `assertAllowedUrl(source, url)`: https only, host in `allowedHosts`, no credentials, no private addresses; redirects are followed manually and re-checked each hop.
- A **contract test suite** (`runSourceContract(source, fixtures)`): feeds recorded responses and checks every returned object against the contract. Each adapter ships its fixtures; no test touches the network.

## Routes (generic, one set for every source)

```ini
GET /api/library/sources                          enabled sources and what they serve
GET /api/library/search?source=&kind=&q=&cursor=  one source, or "all" (merged, deduplicated)
GET /api/library/assets/{ref}                     detail with variants
GET /api/library/assets/{ref}/file?variant=&role= the file's bytes, streamed through the allowlist and a size cap
```

- Rate limit per user (per address when signed out), response `cache-control: private`, errors in the same `{ message }` shape the other routes use.
- The old `/api/polyhaven/*` routes are gone: their callers (the AI and the world scripts) use the generic ones.

## Sources

### Poly Haven (first adapter, direct)

Kinds `model` and `material`. Reuses what exists: the model GLB packing (moved to a shared `packGltf` server util, since any source that serves glTF with companion files needs it), the texture file rules, the search through `parseSearch`. Preferred over the same assets reached through an aggregator.

### shep (`https://3d.shep.bot`, second adapter, aggregator)

From its OpenAPI: `GET /v1/search` (`q`, `type`, `free`, `downloadable`, `providers`, `limit`, `offset`), `GET /v1/assets/{id}`, `GET /v1/assets/{id}/files`, `GET /v1/providers`. Ids are `provider:nativeId`, which maps straight onto `AssetRef` (ours is `shep:polyhaven:WoodenChair_01`).

- `type` maps to our `kind` (`model`, `material`, `texture`, `hdri`, `audio`…), so this one adapter already serves many kinds.
- `offset` is per source and there is no total or cursor: our cursor is the offset and `total` is left out.
- Files carry `mapType`, `group` and `includes`, which map to `role` and `RemoteFile.includes`.
- `license` and `price` map directly. Assets with `downloadable: false` (or `access: link` providers) are shown with **View on {site}** instead of an import button.
- No CORS statement and a public limit of 120 requests a minute: server side only, cached, with our own limiter below theirs.
- A self-hosted instance is supported through `SHEP_API_URL` and `SHEP_API_KEY` (`Authorization: Bearer`).
- Its file URLs point at each provider's own domain (`grab3d.com`, `opengameart.org`, `upload.wikimedia.org`…), which no fixed list can follow. So the adapter accepts any named public https host and, before every request and every redirect, resolves the name and refuses it if it points at a private, loopback, link-local or reserved address. `SHEP_CDN_HOSTS` turns that into a fixed list for a stricter deployment.
- Its `/v1/providers` list becomes a **facet** in the UI (filter by origin) rather than a separate source.

### Aggregators and duplicates

`info.covers` lists the sources an aggregator already includes. When both the direct source and the aggregator are enabled, results from the aggregator that the direct source covers are dropped from merged searches, so Poly Haven does not appear twice.

### Adding a source later

One file in `src/lib/server/library/sources/`, its fixtures and one line in the registry. Enabling is by env (`LIBRARY_SOURCES=polyhaven,shep`) so a deployment can turn sources off or keep a paid one out.

## Importers (per kind)

An importer takes an `AssetDetail` and a chosen variant, downloads through the generic file route, and puts the result into **the person's own assets**, so projects work offline and the existing save-to-cloud sync uploads what a scene uses.

- __material__: download each map, convert to WebP with `optimizeImage` (`TEXTURE_PRESETS`: colour 0.82, normal 0.92, ARM 0.88, max 2048 px), import as `image` assets, return `{ albedo, normal, arm, size, mapping }` for a `material` component. Sources that give roughness / AO / metallic as separate maps (ambientCG style) are __channel-packed into one ARM map in the browser__ (R = AO, G = roughness, B = metallic) so the engine keeps using three maps.
- **model**: take the `model` file as GLB (a glTF with companions is packed server side first), run the existing GLB analysis, which enforces the platform limits (25 MB, 300 000 triangles, 24 images), and import as a `model` asset. Formats the engine can not load (FBX, OBJ, Blend, USD) are listed but marked *needs conversion* and their import button is disabled; a converter is out of scope. A later step runs the model optimizer from `docs/content-optimization-plan.md` (WebP textures, meshopt) on the result.
- Everything goes through `importAsset`, so limits and manifests stay consistent.

### Provenance and licences

Imported assets remember where they came from. The asset **manifest** gets an optional `provenance` (`source`, `ref`, `sourceUrl`, `author`, `license`, `importedAt`). It is metadata next to the bytes, so the content address (SHA-256 of the bytes) does not change and importing the same file twice is still free.

- The browser shows a licence badge on every card, and **Commercial use only** is on by default because the platform has a marketplace and credits. Unknown licences count as not commercial.
- Attribution-required assets are listed when a world is published, so a Credits list can be built from provenance (a later step, not part of the first version).

## Studio UI

- **`ExploreBrowser.svelte`** (generic): source filter, search box, a grid of cards (thumbnail, title, author, licence badge, size or polygon count), paging by cursor, a detail pane with the variants (resolution, format, size) and **Import**. It takes a `kind` and an `onpick(result)`; it knows nothing about models or materials.
- **`ExploreDialog.svelte`**: the browser in a modal. Used by:
   - the `material` component: a **Browse online** button that fills colour, normal, ARM, size and mapping in one go (a component action, like the `worldPreview` field action), and the same button on each image field for a single map;
   - the model picker of the Mesh Renderer: **Browse online**.

- **Explore tab** beside AI in the right panel: Models | Materials switch over the same browser; importing a model offers **Add to scene**, importing a material offers **Apply to selection**.
- __AI tools__ become generic: `search_assets(kind, query, source?)` and `import_asset(ref, variant?)`, plus the existing `stage_set_material`. `search_textures` and `import_texture` are removed once the new ones are in. Results carry the licence so the agent can say what it used.
- **Worlds**: `onImportPolyHavenModel` becomes a generic `onImportLibraryAsset(ref)` hook, host only as today.

## Security and limits

- Server only; every URL passes `assertAllowedUrl`; https only; redirects re-checked; no private addresses.
- Per-user rate limits, per-file size caps (8 MB per map, 25 MB per model), request timeouts.
- Search results are untrusted data: titles and descriptions are rendered as text, never as markup, and are not passed to the AI as instructions.
- No sign-in is needed: a project on this device imports models and materials to the device. Searching and downloading are limited per person when signed in and per address otherwise.

## Phases

**0. Foundation.** The types and helpers in the engine; the registry, `createHttpSource`, `assertAllowedUrl` and the contract test suite; the generic routes; the Poly Haven adapter for both kinds (moving `polyHaven.ts` / `polyHavenTextures.ts` into it, `packGltf` extracted). Old routes become wrappers. Tests offline with fixtures.

_As built: the old `/api/polyhaven/*` routes still call `polyHaven.ts` directly (the adapter is built on the same functions), so nothing that uses them changed; they go away when their callers move in phase 1. `packGltf` is not extracted yet: nothing but Poly Haven needs it until a source serves glTF with companion files, and the generic file route already refuses those with a clear message._

__1. Importers and AI.__ Material and model importers; `provenance` on the manifest; the AI tools moved to `search_assets` / `import_asset`; `onImportLibraryAsset` for worlds.

**2. shep.** The adapter with its fixtures, link-only handling, the CDN allowlist, `covers` de-duplication; self-hosted config.

**3. Studio UI.** `ExploreBrowser`, `ExploreDialog`, the Browse online buttons, the Explore tab.

**4. Further.** ARM channel packing; Credits list from provenance; more kinds (audio, HDRI to skybox, images); a user-added source (their own shep server); persistent cache of downloads; model optimization from the content plan.

## Tests (node, no browser, no network)

- Contract suite per adapter against recorded fixtures.
- `assertAllowedUrl`: schemes, hosts, credentials, private addresses, redirects.
- Pure importer parts: variant choice by resolution, ARM packing math, file-role mapping, "needs conversion" detection.
- Ref parsing and formatting, licence helpers, de-duplication by `covers`.
- Run the usual check and the test suite. Do not drive the browser or the dev server.

## Open points

1. **Commercial use only by default?** Proposed yes (marketplace and credits exist). Unknown licences hidden under that filter.
2. **Require sign-in** for search and import? NO, for rate limiting and abuse can use client ip or some other data; the existing Poly Haven model route is public today.
3. **Formats the engine can not load** (FBX, OBJ, Blend, USD): list as *needs conversion* and skip, or build a converter later? We can create a converter later or implement more model formats in the engine like new standard common usd format. babylon should alredy be compatible with it.
4. **Provenance in the manifest** touches the asset schema and the cloud manifest. Proposed as an optional field; confirm before changing it. Me parece bien, una de las cosas que tenia pendiente era trackear las licencias y origines. asi que es muy buena tu implementacion.
5. **Prefer direct sources over the same assets through shep** (proposed yes). 

## As built

**Done** (the tests run offline, with recorded responses):

- Phase 0: the contract and helpers in `packages/engine/src/library/`; the registry, `createHttpSource`-style JSON client, host allowlist, size caps and the library service in `src/lib/server/library/`; the four generic routes; the Poly Haven adapter. The old `/api/polyhaven/*` routes were removed once nothing called them.
- Phase 1: the material, model, audio and image importers (`src/lib/studio/library/`), with `provenance` recorded in the asset manifest (rebuilt server side from known fields, never stored as received); the AI tools `search_assets` / `import_asset`; `ctx.assets.importFromLibrary(ref, name)` for world scripts (`importPolyHavenModel` stays as an alias so existing worlds keep working).
- Phase 2: the shep adapter, tested against real recorded responses. It leaves out the providers a direct source serves, unpacks ambientCG's ZIPs of maps on the server, lists only GLB models as importable (every other format appears with the reason), and takes its files from any public host after a DNS check against private addresses (or from a fixed list with `SHEP_CDN_HOSTS`). `SHEP_API_URL` / `SHEP_API_KEY` point it at a self-hosted instance.
- Phase 3: `ExploreBrowser`, `ExploreDialog` (one window for the whole Studio, opened with `await explore.pick(...)`), the Explore tab (Models, Materials, Sounds), **Browse online** on the Material component and on the model, sound, picture and map fields.
- **Add optimized** next to **Add to scene** for models, sounds and pictures (materials are always optimized): a model's pictures are re-encoded as WebP (`EXT_texture_webp`) and scaled to at most 2048 px, a picture becomes WebP, a WAV is written at 16 bits, at most 44.1 kHz and mono when both channels are the same. The result is only kept when it is lighter, and the saving is shown. See `src/lib/studio/content/`.
- Phase 4: separate occlusion / roughness / metallic maps are packed into one ARM map; the publish panel lists the credits owed (from provenance) with a Copy button; audio and image importers.

**Left out on purpose**

- Importing FBX, OBJ, Blend and USD (listed as needing conversion). glTF with companion files is not imported either; the generic route refuses it with a message, and `packGltf` is still to be extracted from `polyHaven.ts` when a second source needs it.
- HDRI to skybox, fonts and packs: they can be found but not imported.
- A source added by each person (their own shep server): for now it is a deployment setting.
- A persistent cache of downloads.
- Geometry compression of imported models (meshopt): the engine rejects it today.
- Showing the licence of an asset in the Assets panel (the data is stored; the Explore window shows it).
