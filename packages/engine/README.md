# @kithin/engine

The Kithin WebXR engine as a package: scene graph, interaction, avatars, scripting sandbox, peer-to-peer sessions and the in-game
interface (dash, inventory, keyboard). A game built on it keeps its worlds, models and sounds in its own static files and uses
Kithin only for what has to be shared: accounts, credits, friends, hosted sessions and signaling.

`examples/standalone-game` is a complete game made this way (SvelteKit with `adapter-static`).

## What it asks of the app

The package ships TypeScript and Svelte source, so the app needs Vite with the Svelte plugin and, in its `tsconfig.json`,
`"rewriteRelativeImportExtensions": true`. Babylon.js (`@babylonjs/core`, `gui`, `loaders`) and `svelte` are peer dependencies.

```ts
import { configurePlatform, configureFeatures, loadBundle, useStoredToken } from '@kithin/engine';

configurePlatform({ apiBase: 'https://kithin.example', name: 'My game' }); // where Kithin's services are
useStoredToken();                                    // sign in with a code, token kept in this browser
configureFeatures({ worldsTab: false, inspector: false }); // which parts of the dash are on
await loadBundle('/content/bundle.json');            // the game's own worlds and files
```

```svelte
<script lang="ts">
	import PlayShell from '@kithin/engine/xr/PlayShell.svelte';
</script>
<PlayShell loadWorld={() => bundle.world('level-1')} />
```

`PlayShell` mounts the game on a canvas with the launch screen and the desktop HUD. `mountGame(canvas, roomCode?, options)` is the
same without the interface around it. Everything else is importable by path (`@kithin/engine/ecs/types`, …) for apps that build on
the engine's pieces, as the Kithin site's Studio does.

## Static files

The engine needs a few files served from the app's origin (the Draco decoder, controller profiles, the base avatar, input icons).
Copy them with `kithin-engine-static [destination]` (default `./static`), or host them anywhere and set `assetBase`.

## Configuration

| Call | What it decides |
| --- | --- |
| `configurePlatform` | `apiBase` (Kithin's API), `getToken`/`setToken` (bearer token), `assetBase`, `signalingUrl`, `stunUrls`, `appId`, `name` |
| `configureFeatures` | the dash tabs (`homeTab`, `sessionTab`, `worldsTab`, `inventoryTab`, `settingsTab`, `accountTab`) and the `inspector` |
| `registerContent` | what the app ships: built-in worlds, the scene to start in, a starter kit, files by content hash, repainters |
| `loadBundle` | the same, read from a `bundle.json` (below) |
| `setEngineLocale` | the language; by default the browser's. Texts are in English in the code and translated by the engine itself (`registerTranslations` adds languages) |

Without any of this the engine behaves as it does on the Kithin site: same origin, cookies, nothing shipped.

## Worlds and assets from local files

Put the game's files in a folder:

```
content/
  worlds/level-1.json    a world package (formatVersion 1, name, scene…)
  models/rock.glb        any other file
```

`kithin-engine-bundle content` writes `content/bundle.json`: the worlds, and every other file addressed by the SHA-256 of its bytes,
which is how scenes name models (`{ kind: 'asset', assetId }`). `loadBundle` registers them; the engine finds each file by hash
when a scene needs it. Pictures, sounds and videos can also be plain URLs in the scene.

## Accounts

On the Kithin site the engine shares the session cookie. A game on another origin calls `useStoredToken()`: the dash then offers
**Sign in with a code**: the player types a short code on `https://<kithin>/device` (on a phone, say) and the game receives a
bearer token.

### Apps: one identity for all the levels of a game

A game can have hundreds of levels, and none of them is published on Kithin. Register the game once in **Settings → Apps** on Kithin:
that gives an **app id**, the sites the game runs on (the only ones allowed to call the API) and the products it sells with their
prices in credits. Then:

```ts
configurePlatform({ apiBase: 'https://kithin.example', appId: '<the app id>' });
```

Every world the game opens, from its bundle or built in code, then shares that app's saved data (`ctx.storage`), leaderboards,
purchases and hosted sessions. Prices come from Kithin, never from the game. A world published on Kithin keeps its own set.
`ENGINE_ALLOWED_ORIGINS` is for sites that need access without being an app (your own tools).

## Multiplayer

Sessions use Kithin's signaling server and peer-to-peer data channels. Two engines can play together as long as their
`PROTOCOL_VERSION` (`xr/net/protocol.ts`) is the same; a host refuses a guest from an incompatible one. Bump it whenever a message
changes in a way an older engine cannot read.

## Layout

```
src/xr/          the engine: engine.ts (mountGame), sceneGraph, interaction, net, ui, avatar, sandbox, i18n, platform, content
src/ecs/         slots and components (the scene format)
src/assets/      content-addressed assets and where they come from
src/inventory/   inventories (local, cloud, world, purchased, starter kit)
src/worlds/      world packages
src/document/    the editing model the Studio and the in-game inspector share
src/lighting/    baked lighting
```

Nothing in the package may import from a site (`$lib`, `$app`, `$env`): `tests/engineBoundary.test.mjs` checks it.
