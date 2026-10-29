# @kithin/engine

The Kithin WebXR engine as a package: scene graph, interaction, avatars, scripting sandbox, peer-to-peer sessions and the in-game
interface (dash, inventory, keyboard). A game built on it keeps its worlds, models and sounds in its own static files and uses
Kithin only for what has to be shared: accounts, credits, friends, hosted sessions and signaling.

`examples/standalone-game` is a complete game made this way (SvelteKit with `adapter-static`). To avoid repeating the page, the routes and
the build setup in every game, `packages/game` (`@kithin/game`) provides them: a game is then only `static/` and `src/game.ts`.

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
when a scene needs it. Pictures, sounds and videos can also be plain URLs in the scene. `kithin-game` (`@kithin/game`) lists the
folder by itself on every start and while it watches it, so nobody runs the tool by hand.

Nobody writes a hash either. The bundle also lists every file by its path (`bundle.names['models/rock.glb']`, and `loadBundle(...).assetId('models/rock.glb')`
in the browser), and the scripts that build a game's worlds (Node) ask `contentAssetId('models/rock.glb')` from
`@kithin/engine/assets/contentFolder`, which hashes the file as it is now.

## Building a game's body and world

What a game says about how its players move and what its world is made of, as components (see `docs/ai-world-generation-prompt.md`
for every field):

| Component or API | What it is for |
| --- | --- |
| `characterController` | the player's body (a capsule): slopes, steps, walls, jumps with coyote time, a jump buffer, air jumps, wall jumps and wall slides, pushes (`ctx.world.setPlayerVelocity`), and an optional **lane** for 2.5D games. The same code for a desktop and a headset; it is opt-in (`playerMovement` is the older, simpler one). `physics/character.ts` is the body without Babylon, so a game can test it headless |
| `collider.standable` | a solid that is also a floor on its top, flat or sloped: the way to make a platform, with no ground plane on top |
| `ctx.physics` | `raycast`, `sphereCast`, `overlapSphere` and `closest` against the world's own colliders, in sandbox-safe form: no game needs its own geometry to know what a bullet or a sight line meets |
| `fragment` component and asset kind | a map, a room or a prefab as a file (`assets/fragment.ts`) built under a slot while it is on and taken down when it is off. It is not in the world's slot limit, not saved and not synced (every device builds it from the file), can be loaded several times, and is baked into lighting with `extractScene({ fragments })`. Scripts: `ctx.world.loadFragment(assetId, …)` / `unloadFragment`. The fragment's manifest lists the assets its slots use (`assets`), but a world that is published or shared lists only the fragment's own file: ship the rest with it (a game's bundle does) |
| `ctx.haptics.pulse`, `ctx.world.setPlayerVelocity` | controller buzzes and pushes to a player's body (host only) |
| `ctx.time` | `delta`, `unscaledDelta`, `setScale` for slow motion and `fixed(step)` for a simulation in steps that behaves the same at any frame rate |
| `ctx.audio.playAt`, `rate` | 3D sound from an asset at a point (HRTF), with a little pitch variety |
| `textDisplay` | `background` (transparent too), `titleColor`, `lineColor`, `lineColors[]`, `lineSizes[]` and `billboard` (`'y'` / `'full'`) |
| `meshRenderer.modelScale` | `'fit'` (the default: the model's largest side is made 1) or `'native'` (its own size, in metres); `assets/glbBounds.ts` reads a GLB's box without loading it |
| `ctx.world.flush()` | sends what scripts wrote quietly (`broadcast: false`) as one difference |
| `ctx.hierarchy.getSlotHash(id)` | a stable SHA-256 of an object and its descendants, for recognizing an inventory copy with fresh ids or a moved root; geometry, local child transforms and authored components count, session state does not |

## Scripts as modules

A script is a TypeScript file whose default export is `defineScript((ctx) => handlers)` (`@kithin/engine/script`): `ctx` and the handlers
are typed, and the file imports what it likes from the game's own modules. `@kithin/game/script-bundle`'s `bundleScript(entry, { inject })`
turns it into the body of a `codeBlock` when the world is built, and `kithin-game check` type-checks it with the rest of `src/`.

## Testing a world's scripts

`@kithin/engine/testing` runs a world's scripts without a browser or a headset: `createTestWorld(tree, options)` keeps the world's real slots,
answers the engine's own `ctx` over a host made of plain data (physics included, built from the colliders; fragments are built when
their slot is on), and records what the scripts asked for (`spawned`, `writes`, `teleports`, `velocities`, `haptics`, `audio.played`, `flushes`).
Time only moves when the test says so (`world.tick(seconds)`), players have a head and hands that can be put anywhere, and `equip` /
`trigger` deliver `onEquip`, `onTrigger` to the scripts as the engine does:

```ts
const world = createTestWorld(tree, { fragments });
world.addPlayer({ id: 'p1', head: [0, 1.6, 0] });
const director = world.run('director');
world.tick(2);
expect(world.component('score', 'textDisplay').lines[0]).toBe('0');
```

## World checks and baking

`kithin-game check` (and `kithin-game lint`) runs `worlds/lint.ts` on every world of the game: panels that ask for more room than they have,
a sign that shows its back or sits where nobody reads it from the start (`text-faces-away`, `text-too-high`, `text-grazing`), and a panel
with buttons that nobody can reach (`panel-out-of-reach`). `lighting/job.ts` bakes a region (all the cores, `lighting/parallel.ts`), keeps
the file when its signature (the surfaces within reach, the lights, the sky, the grid and the settings) has not changed, checks the result
(`lighting/qa.ts`: noise, dark voxels, cells cut by thin walls) and leaves a picture of two slices of it. A `lightVolume` of a slot that
is off lights nothing.

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
`PROTOCOL_VERSION` (`xr/net/protocol.ts`, 3 now) is the same; a host refuses a guest from an incompatible one. Bump it whenever a message
changes in a way an older engine cannot read.

What a script changes is sent as a **difference**, not as the world: `scene-delta` carries only the components that changed (and a slot
switched on or off), so a change of a text costs the text. A pose goes with the state stream; what changes the shape of the hierarchy
(a spawn, a reparent) is still a snapshot. Writes made with `broadcast: false` are held and go out with the next sending write or
`ctx.world.flush()`. `impulse` and `haptic` carry `setPlayerVelocity` and `ctx.haptics.pulse` to the guest whose body it is.
Messages are JSON; a typed binary schema would pay for itself only on the hot paths (`scene-state`, presence), not on slot data, and is not done.

## Layout

```
src/xr/          the engine: engine.ts (mountGame), sceneGraph, interaction, net, ui, avatar, sandbox, i18n, platform, content
src/ecs/         slots and components (the scene format)
src/assets/      content-addressed assets and where they come from
src/inventory/   inventories (local, cloud, world, purchased, starter kit)
src/worlds/      world packages
src/document/    the editing model the Studio and the in-game inspector share
src/lighting/    baked lighting (bake, parallel and incremental jobs, quality checks)
src/physics/     the shapes, the collision world and the character body, without Babylon
src/testing.ts   the test world for a game's scripts
src/script.ts    `defineScript` and the types of `ctx`
```

Nothing in the package may import from a site (`$lib`, `$app`, `$env`): `tests/engineBoundary.test.mjs` checks it.
