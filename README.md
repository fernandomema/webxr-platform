# webxr-platform

Plataforma WebXR inspirada en NeosVR/Resonite: cada usuario aloja su propio mundo desde su navegador; el servidor solo actúa de señalización (rendezvous WebRTC) para que host y visitantes se conecten por P2P. El "juego" (`/`) carga sin login y funciona en local hasta que decides alojar o unirte a un mundo.

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

Abre `http://localhost:5173`. Sin login ya carga el lobby local; el panel Dash (tecla `M` en escritorio, botón de menú en el mando) da acceso a login, mundos e inventario.

## Producción

```sh
npm run build
node server.ts   # Node 22.18+ ejecuta .ts nativamente, sin paso de compilación
```

`server.ts` envuelve el `handler` de adapter-node en un `http.Server` propio y le adjunta el WebSocket de `/signaling` — mismo handler (`src/lib/server/signaling.ts`) que usa `vite dev` vía `src/lib/server/wsDevPlugin.ts`.

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

Equipment is session state, so the slot's saved `parentId` never changes. In a hosted session a guest's equip and trigger are requests that the host validates and runs once. A hand holds one object; a player's equipment is released on disconnect, when the object is deleted, or when the world changes. While an equipped object listens to the trigger, that hand's laser and UI clicks are off.

After updating an existing database, run `npm run db:push` against the intended database before using cloud inventory or publication. For local-only guest worlds, IndexedDB does not require a schema update. `npm test`, `npm run check`, and `npm run build` provide the current automated checks.
