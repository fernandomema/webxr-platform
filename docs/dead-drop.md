# Dead Drop

A cooperative extraction shooter (a development world, `dead-drop`). A squad of up to four prepares in a bunker, is sent into a raid on a map made from a seed, loots it while soldiers, dogs and turrets hunt by sight and by noise, and has to reach an open exit alive. What a player carries is theirs only if they get out; a player who dies loses it, and a teammate can take it from the bag they left. Between raids the stash, the trader and the refuge's improvements give a reason to go again.

The game is one script of the world (the director on the `dd-hub` root, `deadDropScript.ts` and `deadDropEconomy.ts`) plus a small script on each of the four guns. The bunker's console, stash screen and trader screen hang below the root, so a press on any of them reaches it. The engine only provides what any world can use: the poses of the players, teleporting, walls, storage and leaderboards.

## Loop

1. **Bunker.** Take a gun from the rack and equip it, press JOIN on the console (it shows the kit you will take), then START RAID. Any player who holds a gun can start. The lamps on the raid gate show whether a raid is on.
2. **Kit.** What the stash screen says: weapons, armour, rounds, medkits, a suppressor, and the contents of the case. A player with nothing still gets a pistol and 36 rounds.
3. **Raid.** 12 minutes. A 3 x 3 map of rooms made from a seed (`deadDropGen.ts`): every room is reachable, extra doorways make loops, the vault is the furthest dead end and holds the best loot (and usually a heavy), barracks may keep dogs, storage rooms have shelves, control rooms have desks. Two of three exits are open. Nobody is noticed for the first 6 seconds.
4. **Out.** Standing 8 seconds inside an open exit gets a player out; the weapons, armour, pack and case go back to their stash. Lockdown is announced at 9 minutes (a siren sounds); at 12 whoever is still inside is lost.
5. **Death.** The pack and the weapons are left in a bag where the player fell (a teammate who looks at it, or puts a hand on it, takes what fits). The **case** is the exception: what is in it comes home whatever happens. After 5 seconds the player is back in the bunker.
6. **Trade.** The trader pays an item's full value and sells for 50% more. With the money, buy gear or improve the refuge.

## The stash and the trader

- **Stash screen** (west wall, beside the lockers): nine rows, each with a pair of arrows. Primary, sidearm, armour (or the best owned), rounds, medkits, suppressor, and up to three case slots. The screen shows the kit that comes out of it, and never promises something twice or something the stash does not hold.
- **Trader screen** (on his counter): BUY (rounds, medkit, pistol, submachine gun, suppressor, vests), SELL (the stash, most valuable first; SELL ALL LOOT) and REFUGE.
- **Refuge:** *Bigger pack* (+2 slots, three levels), *Secure case* (one more slot kept on death, two levels) and *Infirmary* (+10 health, three levels). Each costs more than the one before.
- Both screens belong to whoever pressed last; the other player's data is never touched.

## Stealth

Nobody sees anyone for the first 25 seconds of a raid, and nothing lives within two rooms of the way in (no soldier route, turret or dog). Noticing takes time: an enemy has a **notice meter** that fills faster the closer the player is (0.8 s at point-blank, 2.8 s at the edge of its sight) and drains at 0.45 per second while the player is out of its view. Over its head a yellow ball grows with the meter; at 25% the enemy stops and turns to look; when it is full it fights, and a red "!" shows. Dogs sleep on their feet until they hear a shot (60% of a man's hearing) or see somebody, then growl for 0.9 s before they charge.

Soldiers carry the rifle low on patrol with the arms swinging, raise it when something is up, shoulder it to aim, kick with every shot and rock back when hit; the head turns when they search. A dog lowers its head to creep, wags its tail in a fight and its legs swing from the body.

## Noise

Every shot is a noise: pistol 25 m, submachine gun 35 m, a quarter of that with a suppressor. Soldiers and dogs inside that radius, and not in a fight, go to look; through a wall the radius is about half. A soldier that sees a player calls the ones within 10 m. Turrets only see.

## Enemies

| | |
|---|---|
| **Soldier** | Patrols a route. Aims with a red laser that follows the player and **locks 0.12 s before the burst**, which goes where the player was: a step to the side after the laser stops moving makes it miss. May leave a clip. |
| **Heavy** | Bigger, with armour that stops half of what hits its body (not its head), a long burst and 220 health. Guards the vault. Always leaves something worth taking. |
| **Dog** | Runs at what it has seen, much faster than a man, and bites from close range. Kept in the barracks. Falls in two or three shots. |
| **Turret** | Fixed on top of cover, with a cone of sight. Never moves, ignores noise. |

A shot is a ray against the player's body (a capsule from the feet to the head), not a dice roll. Soldiers never end up in a wall: they steer by rays and are kept out of the walls, cover and furniture by their boxes.

## Reading it in a headset

There is no screen, so everything is on the gun: bars for health, magazine and pack that follow the numbers every frame; an arrow that turns to the nearest open exit; and a few lines of text (weapon and rounds, health, pack and value, time and distance to the exit) rewritten at most once a second. Pickups and hints show as the title of the gun's display for a few seconds. A hit puts a red veil in front of the face and a red mark at the side the shot came from. A heartbeat sounds when health is low.

- **Shoot:** the trigger. The submachine gun fires while held. Each shot has a flash, a boom and a crack, and kicks the gun back; a burst builds up.
- **Reload, medkit, switch weapon:** the radial menu of the equipped gun. This is the one input that works the same in a headset and on the desktop, and the only way a guest reaches the host: the gun's script spawns a short-lived slot under `dd-cmd`, which the director reads.
- **Pick up:** with a hand on the loot (headset), or looking at it from close by (desktop), for a third of a second. A pickup rings, higher the more it is worth.
- **Aim:** from the muzzle of the gun in a headset; from the eye along the crosshair on the desktop (a guest on the desktop sends no hand, so for the host their gun is not where they hold it).

## What the script does to the world

Everything that moves is a pooled slot that is **parked** (far below the floor) and moved with `setWorldPose`; guests see it through the ~20 Hz transform updates, which cost almost nothing. Parts that move inside something (legs, the gun's bars and recoil, the arrow) use `setLocalPose`. Switching a slot on or off, or changing a colour or a text, only reaches guests with a whole snapshot, so those changes are made without broadcasting and sent once with a `flush` (at most every 0.12 s). Sounds, sparks, flashes and the red marks are ephemeral slots (see below).

The raid's walls, floor and ceiling use Poly Haven materials (CC0) by address, so nothing is imported; the world needs the network to show them.

## Generic engine APIs this added

None of these is specific to the game.

| API | Use |
|---|---|
| `ctx.world.getPlayers()` | Everyone in the world: `{ id, name, role }`. The ids are the ones `onPlayerReady`, hand events and `ctx.storage.player` use. |
| `ctx.world.getPlayerPose(id)` | `{ head, left?, right? }`, each with `position`, `rotation`, `forward`, `up`, `right`; `null` for someone not here. A desktop player has no hands. |
| `ctx.world.teleportPlayer(id, { position, yaw? })` | Puts a player's feet at a position. Host only. A guest is asked by a `teleport` message. |
| `onPlayerLeft(player)` | Runs on the host when a guest leaves. |
| `ctx.world.spawn(slot, { ephemeral: true })` | For a slot with `expires`: guests get only that slot, not a snapshot. `ctx.audio.play` and `ctx.particles.burst` use it. |
| `ctx.world.setLocalPose(id, { position?, rotation?, scale? })` | Moves or scales a part inside its parent, including the parts of an equipped tool (which `setWorldPose` refuses). Cheap with `broadcast: false`. |
| hand events | `playerId` in `onEquip` / `onTrigger` and `ctx.equip.holder()` is now the id the guest announced, so it can go straight into `ctx.storage.player`. |

Also: the host sends full snapshots at most every 100 ms (calls that come sooner are folded into one), and the player's body notices a wall that appears or is switched on or off in the same frame, and ignores a mesh that is switched off.

## The bunker

The squad arrives through a blast door in the south wall. The **gear wall** beside it (east of the door) shows what the stash of whoever stands within 6.8 m holds: guns on pegs, a vest on each mannequin, cans for the rounds, medkits, the suppressor and the loot. The stash and trader screens and the console wake the same way, for the nearest player within 3.4 m. The console shows JOIN or LEAVE for the player at it, and only the host can start, once everybody in the bunker has joined.

## Lighting

Dead Drop is lit by **baked lighting** (see `packages/engine/src/lighting/`), not by the flat ambient light: the bunker is one irradiance volume and each of the nine rooms of the raid has its own, baked with every doorway shut (the doorways and the cover are switched on and off at run time and are not in the bake). The lamps are `baked: true`, so they do not run live while the baked light is in use, and the sky's ambient is turned off. The director dims each room by its kind (barracks and storage darker, the vault red), leaves two rooms almost black, and pulses everything red in the lockdown, by setting `intensity` and `tint` of the `lightVolume` of each room.

- Bake again after changing walls, lamps, colours or a room's position: `npm run bake -- dead-drop` (or `npm run bake -- dead-drop hub room-11` for some regions). It writes `static/worlds/dead-drop/lighting-*.lvol` and `src/lib/content/bundledLighting.ts`. `tests/deadDropLighting.test.mjs` fails when the files are older than the world.
- `?lightdebug=off` shows the world without the baked light, `?lightdebug=only` shows the light alone.
- Not done: the flashlight on the guns, and baking inside the Studio.

## Persistence

One `profile` object per player in `ctx.storage.player(player)`: credits, stash, loadout, improvements and counters. It is read when the player arrives (an older profile is filled in with the defaults) and written whenever it changes: a purchase, a choice at the stash, the kit leaving the stash, the end of a raid. In a world that is not published the store lasts for the session. Loot value goes to the `dead-drop-loot` leaderboard. Storage is trusted-client: no anti-cheat.

## Tuning

Numbers live in `deadDropData.ts`: items, weapons, enemies, drops, the trader's stock and the improvements, the raid's length. `tests/deadDrop*.test.mjs` run the same script against a stand-in engine with the real walls, so a changed number is checked in the same way.

## Not done yet

The gun's flashlight, a boss, more weapons and mods, more maps and themes, a world preview image and translations. Moving enemies reach guests without interpolation. Nothing has been looked at in a browser or a headset: the proportions, the text sizes, the sound mix and the feel of the fights need a pair of eyes and hands.
