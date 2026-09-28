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
