# webxr-platform

Plataforma WebXR inspirada en NeosVR/Resonite: cada usuario aloja su propio mundo desde su navegador; el servidor solo actúa de señalización (rendezvous WebRTC) para que host y visitantes se conecten por P2P. `/` es la landing; el "juego" vive en `/play`, carga sin login y funciona en local hasta que decides alojar o unirte a un mundo.

Ver `/home/fernando/.claude/plans/crea-un-nuevo-proyecto-precious-breeze.md` para el plan/arquitectura completos.

## Stack

SvelteKit 2 + adapter-node · Tailwind v4 · better-auth (email/contraseña + Discord) · Prisma 7 + Postgres (`prisma dev` local) · Babylon.js (motor WebXR) · wuchale (i18n, en/es) · WebSocket de señalización propio (sin dependencias externas, un único handler TS reutilizado en dev y producción).

## Desarrollo

```sh
npm install

# en otra terminal: levanta Postgres local y deja corriendo
npx prisma dev

# copia la URL que imprime a .env (o cp .env.example .env y edítala)
npx prisma db push

npm run dev
```

Abre `http://localhost:5173/play`. Sin login ya carga el lobby local; el panel Dash (tecla `M` en escritorio, botón de menú en el mando) da acceso a login, mundos e inventario. `http://localhost:5173` es la landing.

## Producción

```sh
npm run build
node server.ts   # Node 22.18+ ejecuta .ts nativamente, sin paso de compilación
```

`server.ts` envuelve el `handler` de adapter-node en un `http.Server` propio y le adjunta el WebSocket de `/signaling` — mismo handler (`src/lib/server/signaling.ts`) que usa `vite dev` vía `src/lib/server/wsDevPlugin.ts`.

## Meta Quest PWA package for `/play`

The package is a Trusted Web Activity that loads the hosted game from `https://kithin.app/play`. It requires the site to remain online. The Meta Quest [packaging guide](https://developers.meta.com/vr/documentation/web/pwa-packaging/) uses `@meta-quest/bubblewrap-cli` 1.24.1.

1. Deploy this version of the site. Confirm that `https://kithin.app/manifest.webmanifest`, `/play`, and the icons under `/icons/` return successfully. Run `node scripts/package-meta-quest.mjs check-local` before deployment and `node scripts/package-meta-quest.mjs check` after it. The production check is required: Bubblewrap reads the public manifest, not the file in this repository.
2. Install the CLI with `npm install --global @meta-quest/bubblewrap-cli@1.24.1`. On this computer, keep any Bubblewrap JDK and Android SDK downloads on `/run/media/fernando/HDD 1TB`. Bubblewrap defaults to `~/.bubblewrap/jdk` and `~/.bubblewrap/android_sdk`; create directories on that disk and symlink those two default paths to them before the first run. The symlink paths have no spaces, which Android SDK tools require.
3. Run `node scripts/package-meta-quest.mjs init`. This initializes `meta-quest-package/` from **`https://kithin.app/manifest.webmanifest`**. Select `immersive` app mode, a permanent unique Android package identifier, and no Horizon Billing unless in-app purchases have been configured. Save the signing keystore, alias, and passwords securely outside Git. Keep the same signing key for every update.
4. In `meta-quest-package/`, run `keytool -list -v -keystore <keystore-path> -alias <alias>` and `bubblewrap fingerprint add <SHA256-fingerprint>`. Publish the generated `assetlinks.json` at `https://kithin.app/.well-known/assetlinks.json`, then confirm it returns the generated JSON. If this origin hosts other packaged apps, merge their statements into the same JSON array.
5. Run `bubblewrap build` in `meta-quest-package/`. The result is `app-release-signed.apk`. Verify the package and the hosted Digital Asset Links before sideloading with `adb install app-release-signed.apk` on a developer-mode Quest.

The package directory is ignored by Git because it can contain signing material. The `assetlinks.json` file needs the real package name and signing fingerprint; a placeholder cannot verify the immersive app.

## Variables de entorno

Ver `.env.example`. `DATABASE_URL` (de `prisma dev`), `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`, `DISCORD_CLIENT_ID`/`SECRET` (opcional), `PUBLIC_STUN_URLS`.

## Scripts útiles

- `npm run db:studio` — Prisma Studio
- `npm run db:push` / `db:migrate` — sincronizar el schema
- `npm run i18n` — extraer/actualizar catálogos de wuchale (`src/locales/*.po`)
- `npm run check` — svelte-check

## World workflow

- In `/studio`, create a world or open a saved world revision. Saving a world creates a new, immutable revision in the selected inventory adapter; it does **not** publish it.
- In the XR Dash inventory, **Save world** stores the current scene in Local, Cloud, or This World. World items can be loaded or placed as orbs. The orb contains a bounded snapshot and source metadata, so a participant can load or host it even when the original is in another player's local inventory. **Save a copy** stores a new world in the recipient's inventory, never in the author's.
- Point the XR laser at an orb and press the upper trigger (or click it on desktop). **Load map** uses the orb's default private session; **Custom session** opens the session settings panel. Guests can host private rooms and others can join by room code or `/?room=<code>`.
- Publishing is explicit: use **Publish** in the Studio editor, either as a new world or as a new revision of one of your published worlds. Published worlds have immutable, pinned revisions, are listed in the Worlds tab, and are independent of active sessions. Publishing a later revision does not rewrite existing orbs.
- `friends` and `friends-plus` are displayed but disabled until a friend graph and server-side access checks exist. Private sessions are unlisted, but anyone holding their room code can join. Code blocks are currently executable browser JavaScript, not a security sandbox; do not load untrusted worlds.

## Studio

`/studio` lists your projects (this device and, when signed in, the cloud) and offers templates. Opening one goes to `/studio/edit`, with an object hierarchy, a 3D view and an inspector. **Simple** mode shows the common properties; **Advanced** adds the code editor, the scene JSON and every component. Work is autosaved as a local draft, undo/redo and `Ctrl+S`/`Ctrl+K` work as expected, and **Play** opens the scene in the game.

## Controller models

Controller profiles and models (Meta/Oculus Touch) are served from `static/xr-input-profiles` and Babylon is pointed at them in `engine.ts`, so controllers initialise even when the headset cannot reach `immersive-web.github.io` (that request hangs instead of failing, and no controller would ever appear). Assets are from `@webxr-input-profiles/assets` (MIT).

## Equippable objects

An object with **Grabbable** and **Equippable** can be grabbed with the hand or the laser, and then equipped from its radial menu (Y on the left controller, B on the right). Once equipped it stays in that hand after the grip is released, at the pose stored in `equippable.left` / `equippable.right` (relative to the controller grip, position in metres and rotation in degrees). The same radial menu shows **Unequip** without holding anything. Adjust the pose in the Studio with **Preview in hand**.

Code blocks on the equipped object and on its children can declare `onEquip(e)`, `onUnequip(e)` and `onTrigger(e)`. `onTrigger` also works for an object simply held **with the hand** (not with the laser), without equipping it. It receives the trigger of the holding hand (`e.phase` is `press`, `release` or `value`) before the laser or any UI sees it; returning `false` lets the press fall through. Use `ctx.hierarchy.getWorldPose(id)` to spawn from a child such as a gun's `Muzzle`. See the **Pistol** in the lobby template.

UI panels (`uiPanel` + `uiElement` children) support `container` (optionally `overflow: 'scroll'`), `text`, `button`, `input` (with an on-screen keyboard), `image` and `video`. Any code block on an element or one of its ancestors can declare `onUIEvent(e)` (`press`, `change`, `submit`; runs on the host). Scripts drive a `video` through its `src`/`playing`/`currentTime`/`muted` fields (`ctx.world.setComponentField`) and read playback with `ctx.ui.getMedia(id)`; `ctx.net.fetchJson(url)` does an https GET. The `htmlView` component draws a live web page (a sandboxed https iframe) on a plane through the WICG HTML-in-Canvas API (Babylon's `HtmlTexture`); it needs a browser that exposes it (Chrome: `chrome://flags/#canvas-draw-element`) and otherwise shows a notice.

Equipment is session state, so the slot's saved `parentId` never changes. In a hosted session a guest's equip and trigger are requests that the host validates and runs once. A hand holds one object; a player's equipment is released on disconnect, when the object is deleted, or when the world changes. While an equipped object listens to the trigger, that hand's laser and UI clicks are off.

After updating an existing database, run `npm run db:push` against the intended database before using cloud inventory or publication. For local-only guest worlds, IndexedDB does not require a schema update. `npm test`, `npm run check`, and `npm run build` provide the current automated checks.
