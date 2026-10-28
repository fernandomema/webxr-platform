# Standalone game

A game on `@kithin/engine` made of static files: its own worlds and models in `static/content`, Kithin only for accounts, saved data,
credits and multiplayer. It is only `static/`, `src/game.ts` (its name and the world to start in) and a `package.json` with the scripts:
the page, the routes and the build setup come from `packages/game` (`@kithin/game`, see its README), so they are the same for every game.

```sh
npm run dev -w standalone-game          # http://localhost:5174 (npm run check -w standalone-game to type-check)
```

- **Kithin's address** is `https://localhost:5173` unless `VITE_KITHIN_URL` says otherwise. Its dev server uses a certificate of its
  own: open that address once in the same browser and accept it, or the game cannot reach it (it still starts, just without an account).
- **App id.** In Kithin, Settings → Apps → create an app, list `http://localhost:5174` among its sites and put its id in `VITE_KITHIN_APP_ID`
  (for example in a `.env` file here), or give `appId` to `defineGame`. Saved data, leaderboards and purchases then belong to the app, shared by all the game's levels.
- **Sign-in** is by code: the Account tab of the dash shows a code to type at `<kithin>/device`.
- **Content.** `static/content/worlds/*.json` are world packages and every other file there is found by its hash; `npm run dev` and
  `npm run build` list them in `bundle.json`.
