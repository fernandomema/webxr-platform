# ROUNDS VR

`examples/rounds-vr` is the duel of ROUNDS (Landfall, 2D, Unity) rebuilt in 3D and VR on the engine. It is a copy, not an inspiration: the maps, the cards and the numbers of the body and the gun come out of the game's files.

## What was read from ROUNDS, and how

Target: `Rounds_Data` of the Steam build (Unity 2022.3.34, Mono). Static reading only; the game was never run.

| What | Where it comes from | Tool |
| --- | --- | --- |
| 24 maps: boxes (position, size, angle) and circles, spawn points | the scenes `level2…level71`: `BoxCollider2D` / `CircleCollider2D` with the transforms of their parents applied | `tools/extract-maps.py` → `src/world/maps.json` |
| 49 playable cards: name, text, rarity, the lines of numbers (`+70% DMG`) and the real multipliers and additions | the card prefabs (`CardInfo`, `Gun`, `Block`, `CharacterStatModifiers`) and the English string table | `tools/extract-cards.py` → `cards.json` |
| The body: 100 HP, run 13.6 units/s, a jump of 4.1 units in 0.5 s, gravity that grows with the time in the air (20·t^1.5 per step), a slow slide on walls, wall jumps | the CIL of `PlayerVelocity`, `PlayerMovement`, `PlayerJump`, `Gravity`, `CharacterData`, `PlayerCollision` (`monodis`) and the `Player` prefab | `MOVEMENT` in `data.ts` |
| The gun and the shield: bullet 50 units/s with gravity 100 units/s² and a push of 5 up, 55 damage, 3 bullets, 2 s reload, 0.3 s between shots; the shield holds 0.3 s, cooldown 4 s; leaving the screen (x ±35.56, y ±20) costs 51 HP; a hit holds the player 0.3 s | `Bullet_Base` (`ProjectileHit`, `MoveTransform`), `GunAmmo`, `Gun`, `Block`, `OutOfBoundsHandler` | `TUNING` in `data.ts` |
| The rules: 2 players, 2 points a round, 5 rounds a match; the loser picks, by shooting a card; then a new map | `GM_ArmsRace`, `CardChoice`, `ApplyCardStats` | `src/script/director.ts` |

The tools need a copy of the game and `pip install UnityPy TypeTreeGeneratorAPI`. (An earlier version of this port said the prefabs could not be read: the headers have to be read by hand, and then `TypeTreeGenerator.get_nodes_up('Assembly-CSharp.dll', class)` parses every component.)

**Scale.** One unit of the game is `SCALE` = 0.6 m. A blob is as wide as a person's torso, a map is 71 × 40 units (43 × 24 m), and every length, speed and acceleration is the game's times 0.6; times are the game's own. Bullets fall as in the game, so a shot reaches about 16 m: far targets are lobbed.

## How it maps

| ROUNDS | ROUNDS VR |
| --- | --- |
| A 2D map | The map's colliders, as boxes turned about z, 3 m deep between two invisible walls; the screen's edges are glass and the top is closed. Each map is a **scene fragment** (`static/content/maps/map-N.kfrag`), built only while it is played |
| A player is a blob | In a headset or on a desktop the player is a sphere of 0.45 m around the chest; the rival is the blob, with the game's own integrator |
| Run, jump, wall climb | The engine's `characterController`: the game's jump (same height and time up), speed and wall jump (up 0.8, out 0.4 of the jump), a coyote time and a jump buffer, kept in the plane of the fight with a lane (`laneAxis: 'z'`, as deep as the arena); slopes up to 70° are stood on |
| Block | Trigger of the shield (or *Block* in the gun's radial menu) |
| A second player | The room decides: alone you play the bot; with someone else in the room they play orange (**INVITE** opens the engine's session menu) |
| Cards | Shot to be taken; the cards' own numbers, applied the way `ApplyCardStats` does (multipliers multiply, additions add) |
| 70 maps, ~60 cards | 24 maps with static blocks (the ones with hazards, ropes or hundreds of loose boxes are left out); 49 cards that need nothing but a gun, a shield and health (the ones that slow, stun or push a body, or spawn objects, are left out) |

What flies, hits or is blocked is asked of the engine's solids (`ctx.physics`: rays for sight and bullets, overlaps for the rival's body and the places the cards hang), so there is no geometry of the game's own beyond the arena's edges and the sphere of a fighter. The director is TypeScript (`src/script/`, bundled into the code block when the world is built and type-checked by `kithin-game check`) and runs headless in `tests/roundsVr.test.mjs` on `@kithin/engine/testing`.

**The rival** has the same body as a player: it jumps, climbs walls and runs at the game's speed. It sees the other fighter only when nothing is in the way, aims with the arc of the bullet (it solves the angle, with a little error and a limited turn speed), hesitates between shots, and decides once for each shot it sees coming whether to shield or dodge. It reaches the player on 21 of the 24 maps; the other three have places only a person can get to, and the tests keep it to the rest.

**Game feel.** A hit holds the rival for 0.3 s and throws them back (a player is pushed with `ctx.world.setPlayerVelocity` and both controllers buzz with `ctx.haptics.pulse`), squashes the blob, floats the damage up (a sign with no background that turns to the eye by itself, red for damage and cyan for a block), flashes red over a player's eyes and plays a sound from where it happened (`ctx.audio.playAt`, a sample of its own with a little pitch variety); a kill slows the world for half a second (`ctx.time.setScale`); a shield swells when it is hit; the rival's eyes follow its aim. A shot buzzes the hand that holds the gun.

**The HUD** follows each player's head a little above the line of sight (never in the sky): both healths, points, round, magazine, shield. The cards show the game's lines of numbers, green when good and red when not.

## Engine additions (all generic)

- **`characterController`** and **`CharacterBody`**: the body of a player (slopes, steps, walls, wall jumps and slides, coyote time, jump buffer, a lane for 2.5D games); `ctx.world.setPlayerVelocity` and `ctx.haptics.pulse`. The avatar now follows the body's height (it used to stay at the height it was given).
- **`ctx.physics`**: `raycast`, `sphereCast`, `overlapSphere`, `closest` against the real colliders.
- **Fragments**: the `fragment` component and asset kind, `ctx.world.loadFragment`/`unloadFragment`; the baker builds them in. The 24 maps are 24 files, not pools of blocks, so the world has 444 slots (it had 898) and loads a map when it is played.
- **`ctx.time`** (`fixed`, `setScale`), **`ctx.audio.playAt`**, **`textDisplay`** colours, `background` and `billboard`, **`ctx.world.flush`** and field-level **scene deltas** (`PROTOCOL_VERSION` 3).
- **`ctx.world.equipPlayer` / `unequipPlayer`**, **`ctx.ui.openDash(tab, { invite? })`**, **skybox grading**, **light baking** with models as the box they fill (earlier).
- **Tooling**: `kithin-game dev` rebuilds the world when `src/world` or `src/script` change and lists the content folder again; `kithin-game check` runs the world lints; the bake runs on every core, skips regions whose scene did not change and checks what it made.

## Look and lighting

An arcade parlour for the lobby (its cabinet is the menu), four looks for the maps, baked lighting, models made by `tools/make-models.py`, music and cues by `tools/make-audio.py`. Each map is a fragment (`fragments.ts`: its blocks, with the look's material, and its baked lights, moved out of any block they would be inside); the world holds one slot per map, with the map's baked lighting under it, and the director switches the one in play on (the others are not built). Baking all 25 regions takes about 80 s on 4 cores and 25 s when a few changed; `.bake/` has a picture of each.

## Limits to know

- Looked at on a desktop in a slow (software) browser, never in a headset: the feel of a 2.5 m jump, running at 8 m/s, and the legibility of the HUD still need a session in one. `SCALE` and `HUMAN` are the knobs.
- The maps' moving platforms, ropes, saws and loose boxes are not there: the blocks are static. 46 of the game's maps are not included.
- Multiplayer is host-driven like Dead Drop; the invitation, the hosting and a guest's gear were tested against stand-ins, not with two devices. Text and bar changes reach a guest as a difference (`ctx.world.flush`), at most every 0.05 s when there is a sound and 0.12 s otherwise; a map is built by each device from its file (the host waits for its own, up to 8 s).
- The sounds are synthesised (no voices, no real samples) and were never listened to; the models are procedural. `tools/make-audio.py sfx` makes the effects (it needs numpy, scipy and ffmpeg).
- The `characterController` in a headset (locomotion, the camera following the body, the avatar's height) and the guest-side delta sync were tested headless and against stand-ins only. The game's air jump (one when walking off a ledge) is approximated by a coyote time of 0.12 s.
- `tests/bistroWorld.test.mjs` fails on this checkout for a reason unrelated to this port.
