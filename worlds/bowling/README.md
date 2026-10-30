# Neon Pin Lanes

A social bowling alley (`/play/bowling` in `npm run dev`). Four lanes, ten-frame scoring for up to four players a lane, bumpers and aim help, a bar, booths, a shoe counter and a jukebox.

- **Play**: take a ball from a return, stand on the approach and swing; let go and it rolls. A ball only set down at the foul line rolls too (desktop). Put a ball back on a return and it goes home.
- **Desk** (behind every approach): JOIN / LEAVE, bumpers, aim help (Easy / Normal / Pro), new game, cheer. A throw on an empty lane starts a game for whoever threw. Best games go to the Hall of Fame (needs a published world and a signed-in player).
- **Ball Works** (the machine by the jukebox): pick one of 12 materials and a finish on the panel, watch the ball in the window, press MAKE BALL and take the ball from the tray; it is bowled like any other and, after a roll, comes back to the return of that lane in the place of one of its own balls (which is put away until the ball leaves). Pictures: `assets/balls/` (drawn by `tools/makeBallMaterials.py`). `bowlingMachine.ts`.
- **Jukebox** (a starter kit object, Starter Kit > Music > Jukebox, loaded here by a `loader`; its code is `src/lib/content/templates/jukebox.ts`): six slots that take records (any `recordDisc` with a song, so players can bring their own). They play one after the other in slot order and round again; everybody hears the same one at the same time, positioned at the jukebox. Taking out the record that plays, or Skip, moves on. With no records it plays a quiet synthesised tune (Ambient on/off on the panel).
- `bowlingLogic.ts`: scoring, turn order, pins and ball physics, as plain JavaScript (tested without a browser). `bowlingScript.ts`: the script that runs the lanes (host only) and the jukebox. The other `bowling*.ts` files are scenery and controls.
- `KITHIN_BAKE=1 npm run bake -- bowling` (the flag adds the lamps that only exist for the bake) after changing a light or the scenery: the lamps are baked (`assets/lighting/alley.lvol`); until the volume is baked they are drawn live.
- Tests: `node --experimental-transform-types --test worlds/bowling/world.test.mjs`.

Models: Bowling Ball and Bowling Pin from the 3D Asset Server (grab3d, CC0). Textures: Poly Haven (CC0). See `LICENSES.md`.

Cost: every pin is a 12k-triangle model and every ball 12k+, so the alley is about 650k triangles: heavy for a Quest 2.
