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

Code blocks are not sandboxed (`new Function`), so a world's script runs with the player's browser session. That is the main open risk; see the plan notes on isolating code blocks.
