# Neon Pin Lanes

A social bowling alley (`/play/bowling` in `npm run dev`). Four lanes, ten-frame scoring for up to four players a lane, bumpers and aim help, a bar, booths, a shoe counter and a jukebox.

- **Play**: take a ball from a return, stand on the approach and swing; let go and it rolls. A ball only set down at the foul line rolls too (desktop). Put a ball back on a return and it goes home.
- **Desk** (behind every approach): JOIN / LEAVE, bumpers, aim help (Easy / Normal / Pro), new game, cheer. A throw on an empty lane starts a game for whoever threw. Best games go to the Hall of Fame (needs a published world and a signed-in player).
- `bowlingLogic.ts`: scoring, turn order, pins and ball physics, as plain JavaScript (tested without a browser). `bowlingScript.ts`: the script that runs the lanes (host only) and the jukebox. The other `bowling*.ts` files are scenery and controls.
- `KITHIN_BAKE=1 npm run bake -- bowling` (the flag adds the lamps that only exist for the bake) after changing a light or the scenery: the lamps are baked (`assets/lighting/alley.lvol`); until the volume is baked they are drawn live.
- Tests: `node --experimental-transform-types --test worlds/bowling/world.test.mjs`.

Models: Bowling Ball and Bowling Pin from the 3D Asset Server (grab3d, CC0). Textures: Poly Haven (CC0). See `LICENSES.md`.

Cost: every pin is a 12k-triangle model and every ball 12k+, so the alley is about 650k triangles: heavy for a Quest 2.
