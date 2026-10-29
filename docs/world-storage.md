# World storage and leaderboards

Persistent data for published worlds, available to code blocks as `ctx.storage` and `ctx.leaderboards`.

## Scopes

| Data | Key | Use |
|---|---|---|
| `ctx.storage.player(player)` | publication + account + key | upgrades, coins, checkpoints |
| `ctx.storage.world` | publication + key | community goals, event state |
| `ctx.leaderboards` | publication + board name + account | best score / best time |

Storage is keyed by the published world (`publishedWorld.id`), so publishing a new revision keeps the data. Publishing as a new world starts empty. Store stable ids (`"generator-2"`), never node ids.

```js
async onPlayerReady(player) {
  const mine = ctx.storage.player(player);
  const upgrades = await mine.get('unlockedUpgrades', []);
  // A purchase is one atomic transaction: both happen or neither does.
  await mine.transaction([
    { op: 'increment', key: 'coins', by: -100, min: 0 },
    { op: 'addToSet', key: 'unlockedUpgrades', value: 'generator-2' }
  ]);
  await ctx.leaderboards.submit('high-score', player, 1200);
  await ctx.leaderboards.showOn(scoreboardSlotId, 'high-score');
}
```

`onPlayerReady(player)` runs on the host for the local player once the world is up and for each guest when it joins. `ctx.world.setSlotEnabled(id, enabled)` switches a slot and its children on or off for everyone (host only).

## Where data goes

- Draft / unpublished world: an in-memory store, discarded when the session ends.
- Published world, signed in: the server (`/api/published-worlds/[id]/storage`, `/leaderboards/[name]`).
- Published world, no account: `ctx.storage.available` is `false`; reads return your default, writes do nothing.
- A host asking about a guest's data does not use its own account: the request is relayed to the guest's client, which runs it with its own session. The server only accepts it when the guest's room was registered for that same publication.

## Trust model and limits

Storage is **trusted-client**: the server enforces limits (16 KB per value, 100 keys per scope, 120 writes per minute, bounded sets, score range, 10k entries per board) but cannot tell whether a script computed a value honestly. Do not use it for competitive rankings that need anti-cheat.

Code blocks run in a QuickJS sandbox (`packages/engine/src/xr/sandbox/`): a world's script cannot reach the page, `fetch`, cookies or the player's session, only the `ctx` API. `ctx.net` is limited to external HTTPS (no cookies) and the `/api/feedback` route.

## Saved objects (`ctx.storage.items`)

Besides keys and values, a world can keep **objects**: a slot and everything under it, with the models it uses, like an inventory. They are kept per published world and **for whoever hosts it**: it is the host's session, so what any player in it saves goes into the host's. A guest has no storage of its own to use here, and nobody needs an account to host (see below).

```js
// A disc put on a shelf is kept under a key, and put back the next time this person hosts the world.
await ctx.storage.items.save('rack-1-2', discSlotId, { name: 'My disc' });
if (await ctx.storage.items.has('rack-1-2')) {
  const loaded = await ctx.world.loadItem({ adapter: 'worldStorage', key: 'rack-1-2' }, { parentId: socketId, position: [0, 0, 0] });
}
```

- **Where they are kept** is the host's choice (Settings, "World storage"): **this device** (the default; IndexedDB and the device's asset store, no account and no cloud space, lost if the browser's data is cleared, not on other devices) or **the cloud** (needs an account, follows the host between devices, counts in the host's storage like an inventory: the objects' data and the models they use. The world's creator pays nothing).
- **Reading** looks in the chosen place and then in the other, so changing the setting does not lose what was saved. **Writing** goes to the chosen place only, and deleting removes from both so a deleted object does not come back.
- Only in a hosted **published** world: in a draft, or as a guest, `ctx.storage.items.available` is false and the calls do nothing.
- Limits: 200 objects per world and host, 2 MB each, keys of up to 64 characters. The cloud routes are `/api/published-worlds/[id]/items` (the account's own objects only) and `/api/world-storage` (what is kept per world, and clearing it); the page for it is Settings > Cloud > "Saved in worlds".
- An object saved from the Dash inventory ("World Storage", only shown while hosting a published world) has no key; scripts find those by `list()`, objects they saved themselves by key.

## Loading objects from outside (`loader`)

The `loader` component and `ctx.world.addLoader` / `loadItem` build objects that live elsewhere into the world while it runs: starter kit, marketplace, an object its owner made **public** (a flag on a cloud item or folder; a public folder makes everything inside it public), or an object saved above. Only the host reads them; everyone sees the result. They are never saved with the world. A source that is private, gone or never saved leaves the slot empty and the world carries on, so an author should test with objects that are public.
