# @kithin/game

Everything a game on `@kithin/engine` needs besides its own files: the page, the routes, the SvelteKit and Vite setup, the engine's
static files and the content bundle. A game keeps **only its own files**, so changing this package changes every game.

```
my-game/
  package.json       scripts that call kithin-game, and the dependency on @kithin/game
  src/game.ts        the game's configuration (and any code of its own, imported from there)
  static/content/    its worlds (worlds/*.json) and every other file it ships
```

```ts
// src/game.ts
import { defineGame } from '@kithin/game';

export default defineGame({ name: 'My game', world: 'level-1' });
```

```json
{ "scripts": { "dev": "kithin-game dev --port 5174", "build": "kithin-game build", "preview": "kithin-game preview", "check": "kithin-game check" },
  "dependencies": { "@kithin/game": "*" } }
```

## What `kithin-game` does

| Command | |
| --- | --- |
| `dev` / `build` / `preview` | Vite with this package's `vite.config.mjs`: SvelteKit with the engine's `app/app.html` and `app/routes`, `adapter-static` (a game is static files only), the `$game` alias for `src/game.ts`, and the folders Vite must be allowed to serve. `--port <n>`, `--host` (the network, for a headset) and `--force` (rebuild Vite's cache of dependencies) are the only options. |
| `dev` also | **Watches** the game: a change in the folders of the world's code (`"kithin": { "world": { "watch": [...] } }`) builds the world again and reloads the page, a change in `static/content` lists the folder again and reloads. It **warns at start** when Vite's prebundled dependencies are older than the engine's sources (the page would run an old engine): restart with `--force`. |
| `check` | Runs the **world lints** (`lint`) and then writes SvelteKit's types and runs `svelte-check`, which type-checks the game's scripts with the rest of `src/`. |
| `lint` | The checks of a world that need no headset, on every world of `static/content/worlds`: panels that ask for more room than they have, a sign that shows its back, hangs high above the player's eyes or is seen edge-on from where they start, and a panel with buttons that cannot be reached (`@kithin/engine/worlds/lint`). Errors fail the command; warnings are printed. The start of the player is the world's `spawnPoint` slots, or where the engine puts them. |

The engine's static files (Draco decoder, controller profiles, base avatar, input icons) are not copied into the game: `dev` and `preview`
serve them from the engine package (a file in the game's own `static/` with the same address wins), and `build` adds them to `build/`.
Before any command it lists `static/content` in `bundle.json` (`kithin-engine-bundle`, ignored by a `.gitignore` it writes there) and
creates `tsconfig.json` (`{ "extends": "./.svelte-kit/tsconfig.json" }`) when there is none, for the editor. The game's `.gitignore`
needs `/.svelte-kit`, `/build` and `/tsconfig.json`.

A game that builds its worlds from code says so in its `package.json`: `"kithin": { "world": { "script": "world", "watch": ["src/world", "src/script"] } }`.
The npm script is then run before every command (so no `predev` or `prebuild`) and again when something it watches changes. The bundle lists
every file by hash **and by path** (`names`), so code that builds the world asks `contentAssetId('models/rock.glb')`
(`@kithin/engine/assets/contentFolder`) instead of carrying a hash.

## Scripts as modules

A script is a TypeScript module whose default export is `defineScript((ctx) => handlers)` from `@kithin/engine/script`; it imports from the game's own
modules (its tables, its ids) and is type-checked by `check`. A world builder bundles it into the body of a `codeBlock`:

```ts
import { bundleScript } from '@kithin/game/script-bundle';
const code = await bundleScript(new URL('./director.ts', import.meta.url).pathname, { inject: { AUDIO: { shot: 'sha256:…' } } });
```

`inject` names constants that are known only when the world is built (the hash of a file): the script says `declare const AUDIO: Record<string, string>`.
Tests run the scripts with `@kithin/engine/testing`.

## `defineGame`

| | |
| --- | --- |
| `name` | Shown on the launch screen and as the page title. The only required one. |
| `world` | The world to start in (its file name under `static/content/worlds`, without `.json`). Default: the first one. |
| `kithinUrl`, `appId` | Where Kithin is and the game's app id (Settings → Apps). Default: `VITE_KITHIN_URL` (then `https://localhost:5173`) and `VITE_KITHIN_APP_ID`. |
| `tokenKey` | Where the signed-in token is kept. Default: the name as a slug plus `.token`. |
| `features` | Which parts of the dash are on (`EngineFeatures`). A game starts without the world browser and the inspector. |
| `platform` | Any other `configurePlatform` setting (`signalingUrl`, `stunUrls`, `assetBase`…). |
| `contentUrl` | The bundle to load. Default: `/content/bundle.json`. |

Code of the game's own (translations, extra content, helpers) lives in `src/` and is imported from `src/game.ts`: it runs before the
engine is configured.

## Limits

The page itself is fixed: a game that needs routes of its own (a menu before the game, say) or another build setup is not served by
this package and starts from `@kithin/engine` directly, as `packages/engine/README.md` describes. The package ships source, like the engine;
it has been run from inside this repository's workspace, not yet installed from a registry.
