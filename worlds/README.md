# Local world packs

Worlds you build in code (several `.ts` files, generated parts, your own models and textures) without adding anything to the project. Each world is a folder here, versioned with the project's git (except what is generated or secret: `assets.ts`, `dist/` and `worlds/.auth.json`), and it never reaches a production build.

```
worlds/
  my-world/
    world.ts        default export { name, description, build() } — the entry point; split the rest into as many files as you like
    assets.ts       generated from ./assets: typed paths -> asset ids (do not edit)
    assets/         your .glb, textures, audio… (any subfolders)
    thumbnail.webp  optional picture for the world (also .png / .jpg)
    dist/           where `export` writes the .kithin file
```

How it works:

- In `npm run dev` every pack shows up under **Development** (and opens at `/play/<id>`). Editing `world.ts` or anything it imports hot-reloads; adding, removing or changing a file in `assets/` reloads the page.
- Files in `assets/` are served by the dev server (`/@packs/…`) and addressed by content hash, the same way a published world addresses them. In code: `import { asset } from './assets.ts'` then `asset('models/chair.glb')` (the editor completes the path).
- Pack code runs in the dev server **and** in Node (for `export`): import the engine as `@kithin/engine/…`, the app's own code by a relative path (`../../src/lib/…`), never with `$lib`. Relative imports end in `.ts`.

The steps below are cells for the [Runme](https://marketplace.visualstudio.com/items?itemName=stateful.runme) extension: open this file with *Runme Notebook* and run them one by one. The first cell sets the pack id; edit the value there and run it, and the cells after it use it (Runme keeps exported variables for the rest of the notebook session).

## 1. Choose the pack

```sh {"name":"pack-id"}
export PACK=my-world
export PACK_NAME="My world"
echo "pack: $PACK ($PACK_NAME)"
```

## 2. Create it

Creates `worlds/$PACK/` with a `world.ts` (floor + spawn point) and an empty `assets/`.

```sh {"name":"pack-new"}
npm run pack -- new $PACK "$PACK_NAME"
```

## 3. Develop it

Starts the dev server. The world is listed under Development; open it directly at `/play/$PACK`. Leave it running (it is a background cell).

```sh {"name":"dev","background":"true"}
npm run dev
```

Drop files in `worlds/$PACK/assets/` while it runs. To regenerate `assets.ts` without the dev server:

```sh {"name":"pack-sync"}
npm run pack -- sync $PACK
```

## 4. Check what you have

```sh {"name":"pack-list"}
npm run pack -- list
```

## 5. Bake the lighting (optional)

A pack says what to bake by exporting `lighting` from `world.ts`, and places the result with `lightVolumeSlots`:

```ts
import { lightVolumeSlots, type PackLighting } from '../../src/lib/worldPacks/lighting.ts';
import { ASSETS } from './assets.ts';

export const lighting: PackLighting = { regions: [{ id: 'hall', min: [-5, 0, -5], max: [5, 4, 5], voxel: 0.25 }], skyIntensity: 0 };
// in build(): ...lightVolumeSlots(ASSETS, lighting.regions)
```

The volumes are written to `worlds/$PACK/assets/lighting/<region>.lvol` (an asset like any other, exported and published with the world). Name regions after the ones you want to bake, or bake all:

```sh {"name":"pack-bake"}
npm run bake -- $PACK
```

```sh {"name":"pack-bake-region"}
npm run bake -- $PACK hall
```

## 6. Export it to a file

Writes `worlds/$PACK/dist/<name>.kiw`: the scene plus every file of `assets/` it uses. It warns about assets the scene references that are not in `assets/` and exits with an error in that case. Use it to import by hand in any Studio, or to keep a copy.

```sh {"name":"pack-export"}
npm run pack -- export $PACK
```

```sh {"name":"pack-open-dist"}
xdg-open worlds/$PACK/dist
```

## 7. Publish from the terminal

It signs in with the cookies of a browser session where you are already signed in, so it publishes as that account.

1. In the browser, signed in on the target site: DevTools > Network > click any request to the site > Request Headers > copy the value of `cookie`.
2. Set the site and save the cookie (it is kept in `worlds/.auth.json`, ignored by git). Run this one in a terminal if the cell cannot ask for input; or set `KITHIN_COOKIE` instead and skip the file.

```sh {"name":"publish-host"}
export KITHIN_HOST=https://your-site.com
```

```sh {"name":"publish-login","interactive":"true"}
npm run pack -- login $KITHIN_HOST
```

```sh {"name":"publish-whoami"}
npm run pack -- whoami
```

3. Publish. It uploads the files the world uses (the ones the platform already has are skipped), then publishes. The first time it creates the world; the id is remembered in `worlds/$PACK/publish.json` and the next runs add a new revision.

```sh {"name":"publish"}
npm run pack -- publish $PACK
```

Options: `--host <address>` instead of `KITHIN_HOST`; `--new` to publish as a second, separate world; `--world <id>` to add a revision to a world you published some other way. A session cookie expires: when it says you are not signed in, repeat step 1 and `login`.

Try it on a local server first (`KITHIN_HOST=https://localhost:5173`; its certificate is self-signed, so start Node with `NODE_TLS_REJECT_UNAUTHORIZED=0 npm run pack -- publish $PACK`).
