# Kithin world generation guide (prompt for any AI)

> Paste this whole document into an AI chat, then describe the world you want.
> The AI does not need access to the project: everything needed to write a valid world is here.

---

## 1. Your task

You generate **worlds for Kithin**, a social VR platform that runs in the browser (WebXR, Babylon.js). People join a world with a VR headset (Meta Quest and similar) or on a desktop (mouse + WASD), meet other people, walk around, grab objects and use scripted tools and games.

When the user describes a world, you answer with **one JSON document: an array of "slots"** (the scene). The user pastes it into **Studio → JSON view → Apply**, which replaces the whole scene.

Output rules:

- Output **valid JSON only** in a single ```json code block: no comments, no trailing commas, no `undefined`, no `NaN`/`Infinity`, no JavaScript expressions. Every number is a literal.
- If you want to explain something, do it briefly **after** the code block, never inside it.
- The JSON must pass every rule in [section 10](#10-validation-rules-hard-limits). Re-check them before answering.
- Write all names, signs and UI text in the language the user asks for (English by default).

---

## 2. Data model in one minute

- A world is a **flat array of slots**. A slot is a transform node (position, rotation, scale) carrying a list of **components** that give it looks and behaviour.
- Slots form trees through `parentId`. A child's transform is **relative to its parent** (local space).
- There are no "prefabs" or "classes": a chair is a parent slot with child slots (seat, legs, back), each drawing one built-in shape.
- Behaviour comes from components (`grabbable`, `socket`, `pressableButton`...) and from **code blocks**: small JavaScript scripts attached to a slot (see [section 8](#8-code-blocks-scripting)).

---

## 3. Slot format

```json
{
  "id": "table-top",
  "parentId": "table",
  "name": "Table Top",
  "position": [0, 0.74, 0],
  "rotation": [0, 0, 0, 1],
  "scale": [1.6, 0.05, 0.9],
  "components": [
    { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#8b5a2b" },
    { "type": "collider", "shape": "box" }
  ]
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | Unique in the whole array, non-empty. Use readable kebab-case ids (`"table-leg-1"`). Never `"dash-panel"` or `"inspector-panel"` (reserved). |
| `parentId` | string or `null` | `null` for a root slot, otherwise the `id` of another slot in the array. No cycles. |
| `name` | string | Human-readable, shown in the editor. Scripts can find slots by name. |
| `position` | `[x, y, z]` | Metres, local to the parent. |
| `rotation` | `[x, y, z, w]` | **Quaternion**, local to the parent. Identity is `[0, 0, 0, 1]`. Never Euler angles here. |
| `scale` | `[x, y, z]` | Local scale. Never 0. Avoid negative values. |
| `components` | array | Zero or more component objects, each with a `"type"`. At most one component of each type per slot. |
| `disabled` | boolean (optional) | `true` hides the slot and its whole subtree (not drawn, not clickable). Scripts can switch it with `ctx.world.setSlotEnabled`. |

No other fields are allowed on a slot. Put the parent before its children in the array (recommended, not required).

---

## 4. Space, units and orientation

- Units are **metres**. **+Y is up.** Babylon.js is left-handed: with +Y up and looking toward +Z, +X is to your right.
- **Where players appear:** there is no spawn-point component. A player starts at about `(0, 1.6, 2)` (eye height 1.6 m) looking toward **+Z**, and when switching worlds keeps standing where they were. So:
  - Always put a walkable floor under the origin, wide enough (at least 20 × 20 m around it).
  - Keep about 2 m around `(0, 0, 2)` free of solid objects.
  - Put the main attraction in front of that point, toward +Z (for example at z = 4…10).
- Eye height is ~1.6 m; tables are ~0.75 m high; hands reach about 0.6 m. Interactive things should sit between 0.8 and 1.5 m high.

### Quaternion cheat sheet

Yaw (turn around the vertical Y axis) by θ: `[0, sin(θ/2), 0, cos(θ/2)]`.

| Rotation | Quaternion | Effect on the slot's local +Z (its "forward") |
|---|---|---|
| none | `[0, 0, 0, 1]` | +Z stays +Z |
| yaw +90° | `[0, 0.7071068, 0, 0.7071068]` | +Z → +X |
| yaw 180° | `[0, 1, 0, 0]` | +Z → −Z |
| yaw −90° | `[0, -0.7071068, 0, 0.7071068]` | +Z → −X |
| yaw +45° | `[0, 0.3826834, 0, 0.9238795]` | |
| pitch +90° about X | `[0.7071068, 0, 0, 0.7071068]` | local +Y → +Z (lays a cylinder along Z) |
| roll +90° about Z | `[0, 0, 0.7071068, 0.7071068]` | local +Y → −X (lays a cylinder along X) |

Round to 7 decimals. A quaternion must be normalised (x² + y² + z² + w² = 1).

### Scale and hierarchy (important)

A parent's scale **multiplies everything under it**, including children's positions. To avoid distorted children:

- Make group/parent slots **unscaled** (`[1, 1, 1]`), usually with a `container` component and no mesh.
- Put the size on the **leaf** slots that draw a shape.

```
Table (container, scale 1,1,1, position on the floor)
├── Top    (box, scale 1.6 × 0.05 × 0.9, y = 0.74)
├── Leg 1  (box, scale 0.06 × 0.72 × 0.06, y = 0.36)
└── ...
```

---

## 5. Built-in shapes

Only built-in shapes are available to you (models imported into the project are referenced by content hashes you do not have). Use `"meshRef": { "kind": "builtin", "id": "<shape>" }`.

| id | Size at scale 1 | Notes |
|---|---|---|
| `box` | 1 × 1 × 1 m, centred | Walls, floors, furniture, buttons. A box of height `h` rests on the floor at `y = h/2`. |
| `sphere` | diameter 1 m, centred | Balls, lamps, orbs. |
| `cylinder` | diameter 1 m, height 1 m along Y, centred | Columns, legs, cans, discs (flatten Y), barrels (rotate). |
| `plane` | 1 × 1 m in the XY plane, centred | Signs, screens, UI, mirrors. See "Which side of a plane is the front". |
| `ground` | **20 × 20 m** in the XZ plane, at y = 0 | Floors. **Walkable and teleportable.** Scale 2 = 40 × 40 m. Keep scale Y at 1. |
| `disc` | diameter 1 m, flat in XZ, facing up | Round floors and platforms. **Walkable and teleportable.** |

### Which side of a plane is the front

A `plane` with identity rotation is read correctly by someone standing on its **−Z side** looking toward +Z. Rule: **the plane's local +Z must point away from the viewer.**

- Sign in front of the starting player, at z = 6, read from z ≈ 2: rotation `[0, 0, 0, 1]`.
- Sign at z = −4, read by a player standing at z ≈ 0 (behind them): rotation `[0, 1, 0, 0]`.
- Sign on a wall at x = 8, read from x < 8: rotation `[0, 0.7071068, 0, 0.7071068]`.
- Sign on a wall at x = −8, read from x > −8: rotation `[0, -0.7071068, 0, 0.7071068]`.

This applies to everything drawn on a plane: `textDisplay`, `scoreboard`, `uiPanel`, `mirror`, `htmlView`.

### Floors, walls and walking

- **Floors**: any slot whose `meshRenderer` is `ground` or `disc`. Players stand on them and can teleport onto them. Add `{ "type": "collider", "shape": "box" }` too.
- **Solid objects** (block walking, and can be stood on: stairs, platforms): a slot with `meshRenderer` + `collider` that is **not** `grabbable` and **not** inside a grabbable. Steps up to 0.4 m are climbed automatically; stairs need steps ≤ 0.3 m.
- Without a `collider`, a mesh is walked through.
- There is gravity for **players**: walking off a floor makes them fall. Falling below y = −20 puts them back at the start.
- There is **no physics for objects**: an object let go stays floating where it was released, unless a `dropZone` or `socket` catches it, or a script moves it.

### Lighting and colour

- There is always a soft ambient light from above. `skybox.ambientIntensity` scales it. Add `pointLight` components for local light (lamps, glowing objects).
- Colours are hex strings `"#rrggbb"`.
- Performance: plain coloured built-in shapes (no `material`, `opacity` 1, positive scale) are drawn as cheap instances; prefer them. Keep a world under ~600 slots and ~10 point lights for headsets.

---

## 6. Components reference

Required fields are marked **(req)**. Everything else is optional; omit a field instead of writing `null`.

### Rendering

**`meshRenderer`**: draws a shape.
- `meshRef` **(req)**: `{ "kind": "builtin", "id": "box" | "sphere" | "cylinder" | "plane" | "ground" | "disc" }`.
- `color`: `"#rrggbb"`.
- `opacity`: 0–1 (1 = solid). Below 1 it looks like glass.

**`material`**: textured PBR surface for the `meshRenderer` of the same slot.
- `albedo`, `normal`, `arm`: each `{ "kind": "url", "url": "https://..." }` pointing to an image (colour map, OpenGL normal map, AO/roughness/metallic packed in R/G/B). Use only URLs you are sure exist; otherwise omit `material` and use `color`.
- `roughness` 0–1, `metallic` 0–1.
- `mapping`: `"mesh"` (stretch over each face, repeated `tiling` times, default) or `"world"` (by real size, `size` metres per repeat, same grain at any scale; best for floors and walls).
- `tiling` 0.1–50, `size` 0.01–100 m, `label` string.

**`pointLight`**: a light at the slot.
- `color` **(req)** hex, `intensity` **(req)** 0–20 (typical 1–4), `range` **(req)** 0.1–100 m.

**`skybox`**: gradient sky behind everything. **One per world**, on a root slot with no mesh.
- `topColor` **(req)**, `horizonColor` **(req)**, `bottomColor` **(req)**: hex.
- `stars`: 0–1. `ambientIntensity`: 0–3 (default 1). `reflectionCapture`: boolean, live reflections on shiny surfaces. `toneMapping`: `"aces"`.

**`textDisplay`**: a sign. Needs a `meshRenderer` with a **`plane`** on the same slot; the plane's scale is the sign's size in metres.
- `lines` **(req)**: array of strings (white text).
- `title`: string (larger, yellow).
- `color`: **background** colour of the sign.
- `scale`: text size multiplier 0.25–6 (default 1). `verticalAlign`: `"top"` | `"middle"`.
- Long lines wrap automatically. A 1.6 × 1.2 m sign fits a title and ~5 short lines at scale 1.

**`scoreboard`**: an arcade-style table. Needs a `plane` `meshRenderer`.
- `columns` **(req)**: string array. `rows` **(req)**: `[{ "name": "Ana", "cells": ["120"], "highlight": true, "isLeader": true }]` (use `[]` initially).
- `title`, `status`: strings. Usually filled by a script.

**`mirror`**: a real-time mirror. Needs a `plane` `meshRenderer`. `resolution` 64–2048 (default 512). Use at most one or two per world (expensive).

**`camera`**: a handheld camera: the slot's plane shows what lies along its local +Z; held in a hand, the trigger takes photos/videos. Needs a `plane`. `resolution` 64–1280.

**`uiPanel`** and **`uiElement`**: interactive 2D UI in the world. See [section 7](#7-world-space-ui-uipanel--uielement).

**`previewCamera`**: where the world's 360° thumbnail is taken from (the slot's position). `fov` 15–110. Optional, one per world.

**`surfaceMask`**: a coating (dirt, frost, paint) over a surface, painted by scripts. Advanced: `color`, `opacity`, `resolution` **(req)** (pixels per side, e.g. 32), `mask` **(req)** (base64 of `resolution²` bytes, 255 = covered). Rarely needed.

### Interaction

**`collider`**: `shape` **(req)**: `"box"` | `"sphere"` | `"mesh"`. Makes the slot solid (see walking rules) and gives grabbable objects a hit shape. For built-in shapes use `"box"` or `"sphere"`.

**`grabbable`**: players can pick the object up (hand grip in VR, click-drag on desktop).
- `scalable` **(req)**: boolean; whether a two-handed grab can resize it.
- `autoGrip` **(req, write it explicitly)**: boolean, `true` makes the fingers wrap round the shape. Always write `"autoGrip": true` unless asked otherwise: the editor's validator rejects a `grabbable` without it.
- Put it on the **root** of the object. Grabbing any child part grabs the nearest ancestor that has `grabbable`. Give the parts a `meshRenderer` and the main part a `collider`.

**`equippable`**: a grabbable object that can be equipped in a hand from the radial menu and stays there; its scripts then receive the trigger through `onTrigger`. Needs `grabbable` on the same slot.
- `left` **(req)**, `right` **(req)**: `{ "position": [x, y, z], "rotation": [pitch, yaw, roll] }`: where it sits relative to the controller grip, metres and **Euler degrees** (not a quaternion). Typical: `{ "position": [0, 0, 0.04], "rotation": [15, 0, 0] }`. The object's local +Z points forward out of the hand: build tools with their "barrel" along +Z.
- `autoGrip`: boolean.

**`pressableButton`**: a physical button pushed by a hand/controller tip **in VR**. Fires the slot's code block `onPress()`. The slot itself moves along `axis` while pushed, so put it on the button cap only (not on its base).
- `axis` **(req)**: direction it moves when pressed, in the parent's space, e.g. `[0, -1, 0]` (pushed down).
- `travel` **(req)**: real metres from rest to fully pressed (e.g. 0.02–0.04).
- `radius` **(req)**: real metres around the press axis that count as touching (e.g. 0.06–0.12).
- `threshold`: 0–1 (default 1).
- It cannot be pressed on desktop (mouse). When desktop players must be able to do the same action, also offer a UI `button` (section 7), which works with mouse and VR laser alike.

**`socket`**: a spot where a matching object snaps in and stays (key slot, record platter, battery holder).
- `accepts` **(req)**: array of tags (empty = anything insertable).
- `radius` **(req)**: snap distance in metres (0.02–2, e.g. 0.2).
- `snap` **(req)**: `{ "position": [x, y, z], "rotation": [pitch, yaw, roll] }` in the socket's space (Euler degrees).
- `playMedia`: boolean: inserting starts the object's `audioPlayer`, removing it pauses.
- Never write `occupantId`.

**`insertable`**: marks a grabbable object as something a socket can take. `tag` **(req)**: string (e.g. `"key"`).

**`dropZone`**: an invisible box (the slot's own unit cube: its position, rotation and scale are the zone's centre, orientation and size). An object released with its centre inside turns upright and settles on the zone's floor. Use it on table tops and shelves so things don't float.
- `align`: `"upright"` (default) | `"nearest"` | `"keep"`. `yawStep`: 0–180 degrees.
- Put it on its own slot without a mesh, e.g. scale `[1.6, 0.4, 0.9]` centred 0.2 m above a table top.

### Media

**`audioPlayer`**: plays music or sound, positioned at the slot. Put it on a slot with a `meshRenderer` (the speaker/object).
- `source` **(req)**: `{ "kind": "url", "url": "https://.../file.mp3" }` (a direct, CORS-enabled audio file).
- `autoplay`, `loop`: booleans. `volume`: 0–1.
- Scripts start/stop it with `ctx.world.setComponentField(id, "audioPlayer", "playing", true)`.

**`impactSound`**: a short generated "knock/click" sound, no file needed. `frequency` 0–4000 Hz, `pitchDrop`, `noiseMix` 0–1, `durationMs` 10–5000, `volume` 0–1. Usually played from scripts with `ctx.audio.play(...)` instead.

**`htmlView`**: a live web page on a plane (experimental: only works in Chrome with a flag; elsewhere it shows a notice). `url` **(req)** https, `width`/`height` px, `interaction`: `"raycast"` | `"overlay"` | `"none"`. Avoid unless asked.

**`recordDisc`**: title/author/colours of a vinyl record (used by record-player builds). `title` **(req)**, `author` **(req)**, `labelColor` **(req)**, `vinylColor`, `labelImage`.

### Logic

**`codeBlock`**: `code` **(req)**: JavaScript source as a JSON string. See [section 8](#8-code-blocks-scripting).

**`scriptState`**: `data` **(req)**: any JSON object. Shared memory that scripts read and the host writes; it is synchronised to every player.

### World

**`velocity`**: moves the slot at a constant speed. `linear` **(req)** `[x, y, z]` m/s (in the parent's space), `drag` 0–1 (speed lost per second). Paused while grabbed.

**`particleBurst`**: a one-off burst of particles. `color`, `count` 1–500, `durationMs`. Usually spawned by scripts (`ctx.particles.burst`).

**`expires`**: `expiresAt` **(req)**: epoch milliseconds; the slot is deleted after that. Only for slots spawned by scripts.

**`stroke`**: a tube through points. `points` **(req)** flat `[x, y, z, x, y, z, ...]` in world space, `color` **(req)**, `width` **(req)** metres. Used by drawing tools.

**`container`**: no fields. Marks a slot as a group. Use it on unscaled parent slots.

**`appInfo`**: how the world presents itself when installed as an app: `name`, `shortName`, `description`, `themeColor`, `backgroundColor`. Optional, one per world.

**`worldPortal`**, **`avatar`**, **`boneAttach`**, **`keyboardKey`**: engine-managed; **do not use them** in generated worlds.

---

## 7. World-space UI (`uiPanel` + `uiElement`)

A UI is a slot tree:

1. A **panel root** slot with `uiPanel` (it creates its own plane; do **not** add a `meshRenderer`).
   - `width` **(req)**, `height` **(req)**: design size in pixels (64–4096), e.g. 1024 × 640.
   - `worldWidth`: physical width in metres (default 1.2); the height follows the aspect ratio.
   - `background`: hex.
   - Orientation follows the plane rule: local +Z must point away from the viewer.
2. **Child slots** with `uiElement`. Their `position`/`rotation`/`scale` are ignored (leave defaults); the layout is a flexbox-like stack:
   - The panel's direct children are stacked **top to bottom in array order**.
   - A `container` lays its children out in `flexDirection` `"column"` (default) or `"row"`, with `gap`, `padding`, `margin`.

`uiElement` fields:

| Field | Applies to | Meaning |
|---|---|---|
| `kind` **(req)** | all | `"container"`, `"text"`, `"button"`, `"input"`, `"image"`, `"video"`, `"slider"` |
| `width`, `height` | all | pixels. Give every element an explicit width and height. |
| `visible` | all | boolean |
| `text` | text, button | the label |
| `fontSize` (8–128), `fontWeight` (`"normal"`/`"bold"`), `color`, `textAlign` (`"left"`/`"center"`/`"right"`) | text, button | typography |
| `background` | container, button | hex |
| `cornerRadius`, `borderColor` + `borderWidth` | container (radius also button) | box style |
| `flexDirection`, `gap`, `padding`, `margin` | container | layout |
| `overflow: "scroll"` | container with fixed `height` | scrollable list |
| `overlayBottom` | container | overlays the parent's bottom edge |
| `placeholder` | input | hint text |
| `src` | image, video | https URL (video MP4/WebM) |
| `playing`, `loop`, `muted`, `volume`, `currentTime` | video | playback (shared by everyone) |
| `value`, `minValue`, `maxValue`, `step` | slider | range |

**Events.** When someone uses the UI, the host runs, in this order: the pressed button's own `onPress()` (if that button slot has a code block), then `onUIEvent(event)` on the element **and every ancestor**. So the usual pattern is **one `codeBlock` on the panel root** that handles everything:

```js
return {
  // event: { type: 'press' | 'change' | 'submit', slotId, text?, value? }
  onUIEvent(event) {
    if (event.type === 'press' && event.slotId === 'quiz-answer-a') {
      ctx.world.setComponentField('quiz-result', 'uiElement', 'text', 'Correct!');
    }
  }
};
```

Update the UI from scripts with `ctx.world.setComponentField("<element id>", "uiElement", "text", "New text")` (or `visible`, `background`...). Read an input with `ctx.ui.getInputText(id)` or from `event.text`.

---

## 8. Code blocks (scripting)

A `codeBlock`'s `code` is the **body of a function** that receives `ctx` and **returns an object of handlers**. It runs once when the slot appears; local variables persist between handler calls.

```js
const SPEED = 1.2; // radians per second
let angle = 0;

return {
  onSpawn() {
    ctx.log('Spinner ready');
  },
  tick(dt) {
    if (!ctx.world.isHost()) return;
    angle += SPEED * dt;
    ctx.self.setWorldRotation(ctx.math.quatFromAxisAngle([0, 1, 0], angle));
  }
};
```

In the JSON, that code is a **single JSON string**: escape double quotes as `\"` and newlines as `\n`. Prefer single quotes inside the JavaScript so less escaping is needed.

### Handlers

| Handler | When it runs | Where |
|---|---|---|
| `onSpawn()` | When the slot is created (world load or spawn). | Every player |
| `tick(dt)` | Every frame; `dt` in seconds. | Every player |
| `onPlayerReady(player)` | A player is identified (local player at start, each guest on join). `player = { id, name }`. May be `async`. | Host only |
| `onGrab()` / `onRelease()` | Someone grabs / lets go of this slot (the grabbable). | Host (and the grabbing peer) |
| `onPress()` | A `pressableButton` on this slot is pushed (VR), or a UI `button` on this slot is clicked (VR laser or mouse). | Host for UI buttons; the presser's device for physical buttons (so always check `isHost()` before changing the world) |
| `onUIEvent(event)` | UI interaction on this element or any element below it. | Host only |
| `onEquip(e)` / `onUnequip(e)` | The object (or its parent) is equipped / unequipped. `e = { hand: 'left' \| 'right', playerId, playerName }`. | |
| `onTrigger(e)` | Trigger of the hand holding this **equipped** object; fires on the slot and all its descendants. `e.phase` is `'press'`, `'release'` or `'value'`, `e.value` 0–1. Return `false` to let the trigger do its normal action; anything else consumes it. | Host only |
| `getRadialItems()` | Returns extra radial-menu entries while the object is held: `[{ label, isEnabled: () => true, onSelect: () => { ... } }]`. | Holder |

### Multiplayer rules (read carefully)

- One player is the **host** (or the only player, "solo"). The host owns the shared state; guests receive snapshots (~20 times per second).
- Every script runs on **every player's** device. Local variables are **not shared**.
- **Only the host can change the world**: `world.spawn`, `deleteSlot`, `setComponentField`, `setComponent`, `setWorldPose`, `setSlotEnabled`. On a guest these calls do nothing. Moving a slot with `ctx.self.setWorldPosition/Rotation` on the host is synchronised to guests.
- So in `tick`, start world-changing logic with `if (!ctx.world.isHost()) return;`.
- Shared game state (score, turn, phase) lives in components: a `scriptState.data` object, `textDisplay.lines`, `uiElement.text`... written with `setComponentField` by the host, readable by everyone via `ctx.self.getComponent(...)` / `ctx.hierarchy.getSlot(id)`.
- Scripts cannot call each other. To coordinate, write to a shared `scriptState` and let others read it in `tick`.
- `setComponentField` with a whole object/array value replaces that field (write a **new** object, e.g. `{ ...data, score: data.score + 1 }`).
- For values written every frame, pass `broadcast = false` and broadcast only every ~100–200 ms (last argument `true`).

### `ctx` API

```text
ctx.self
  .id                                   this slot's id
  .getSlot()                            this slot's data { id, parentId, name, position, rotation, scale, components }
  .getComponent(type)                   one of its components, or undefined
  .getWorldPosition() -> [x,y,z]        world space
  .getWorldRotation() -> [x,y,z,w]
  .setWorldPosition([x,y,z])            moves it (sync from host)
  .setWorldRotation([x,y,z,w])

ctx.hierarchy
  .getSlot(id)                          slot data or undefined
  .getChildren(id)                      direct children (array of slot data); null = root slots
  .getParent(id)
  .findByName(name)                     first slot in the whole world with that name
  .getWorldPose(id) -> { position, rotation, forward, up, right }   unit vectors in world space

ctx.world
  .isHost() -> boolean
  .spawn({ name, id?, parentId?, position?, rotation?, scale?, components? })   host only; omitted fields default to root/origin/identity/1
  .deleteSelf()   .deleteSlot(id)                                               host only
  .setComponentField(slotId, componentType, field, value, broadcast = true)     host only
  .setComponent(slotId, component, broadcast = true) -> boolean                 add/replace a component (not codeBlock)
  .setWorldPose(slotId, { position?, rotation? }, broadcast = true) -> boolean  refused while held
  .setSlotEnabled(slotId, enabled) -> boolean                                   show/hide for everyone
  .findNear([x,y,z], radius) -> slots                                           proximity query (world space)
  .raycast(origin, direction, maxDistance, { ignore: [ids] }?) -> { slotId, point, normal, u, v } | null
  .getPlayer(grabberId) -> { id, name }

ctx.grab     .isHeld() -> boolean     .heldBy() -> grabberId[]
ctx.equip    .isEquipped() -> boolean .holder() -> { playerId, hand } | null

ctx.math
  .vecAdd(a,b) .vecSub(a,b) .vecScale(a,n) .vecDot(a,b) .vecCross(a,b) .vecLength(a) .vecNormalize(a)
  .quatFromAxisAngle([ax,ay,az], radians) .quatMultiply(a,b) .rotateVec(q, v)

ctx.audio
  .play({ frequency, pitchDrop, noiseMix, durationMs, volume })    synthesized hit/beep at this slot (no file)
  .playTrack(source, { volume, loop, offset }) -> Promise<{ time(), duration, playing, ended, pause(), resume(), stop(), setVolume(v) }>
        not spatial, plays only on the calling device; source = { kind: 'url', url }
  .analyze(source) -> Promise<{ duration, bpm, bpmConfidence, onsets: [{ t, strength, band }], energy: { hop, low, mid, high } }>

ctx.particles.burst({ color, count, durationMs })          at this slot's position

ctx.ui
  .getInputText(inputSlotId)            text typed in an input element
  .getMedia(videoSlotId)                playback state of a video element

ctx.net
  .fetchJson(url) -> Promise            HTTPS GET returning JSON (CORS must allow it)
  .postJson(url, body) -> Promise

ctx.storage                             persistent data, only in PUBLISHED worlds with a signed-in player
  .available -> boolean                 false: reads return the default, writes do nothing
  .player(player)                       per player (player from onPlayerReady / getPlayer)
  .world                                shared by all sessions of this world
    each: .get(key, default) .set(key, value) .increment(key, by, { min, max }) .addToSet(key, v)
          .removeFromSet(key, v) .remove(key) .transaction([{ op: 'increment', key, by }, ...])   (all async)

ctx.leaderboards
  .submit(name, player, score, { order: 'high' | 'low' })   keeps the player's best
  .best(name, player)   .top(name, { limit })
  .showOn(scoreboardSlotId, name)       fills a scoreboard (give it columns: ["Score"])

ctx.log(...args)                        debug log, visible in the in-game inspector
```

Standard JavaScript is available (`Math`, `Date.now()`, `JSON`, `crypto.randomUUID()`, `setTimeout`, `async/await`). **Do not use** `document`, `window`, `fetch` or DOM APIs: use the `ctx` API.

### Script rules and good practice

- The code must `return { ... }` with at least one handler, and must compile (`new Function('ctx', code)`). Check every bracket.
- Find related slots by **id** (ids are known when you write the world: `ctx.hierarchy.getSlot('door-panel')`) or by child name (`ctx.hierarchy.getChildren(ctx.self.id).find(c => c.name === 'Muzzle')`). `findByName` returns the first match in the whole world: make names unique if you use it.
- A handler that throws is logged and ignored; it does not break the world.
- Keep `tick` cheap: throttle heavy work (`every -= dt; if (every > 0) return; every = 0.25;`).
- Spawned temporary slots (effects, projectiles) should carry an `expires` component or be deleted by the script.
- Generate ids for spawned slots with `crypto.randomUUID()` when you need to refer to them later.
- Objects have no physics. For falling, bouncing or projectiles, simulate in `tick` on the host (`velocity` component for straight motion, or update positions yourself).

### Common patterns

**Button that toggles a lamp** (button slot has `pressableButton` + `codeBlock`):

```js
let on = false;
return {
  onPress() {
    if (!ctx.world.isHost()) return;
    on = !on;
    ctx.world.setComponentField('lamp-bulb', 'meshRenderer', 'color', on ? '#fde68a' : '#334155');
    ctx.world.setComponentField('lamp-bulb', 'pointLight', 'intensity', on ? 3 : 0);
    ctx.audio.play({ frequency: on ? 880 : 440, durationMs: 80, volume: 0.4 });
  }
};
```

(`on` is per-device: when the state matters to everyone, read it from the component instead: `const lit = ctx.hierarchy.getSlot('lamp-bulb').components.find(c => c.type === 'pointLight').intensity > 0;`.)

**Equippable tool that shoots** (root slot: `container`, `grabbable`, `equippable`, `codeBlock`; a child named `Muzzle` at the tip, along +Z):

```js
return {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const muzzle = ctx.hierarchy.getChildren(ctx.self.id).find(c => c.name === 'Muzzle');
    const pose = muzzle && ctx.hierarchy.getWorldPose(muzzle.id);
    if (!pose) return true;
    ctx.world.spawn({
      name: 'Bolt',
      position: ctx.math.vecAdd(pose.position, ctx.math.vecScale(pose.forward, 0.1)),
      scale: [0.05, 0.05, 0.05],
      components: [
        { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#22d3ee' },
        { type: 'velocity', linear: ctx.math.vecScale(pose.forward, 8) },
        { type: 'expires', expiresAt: Date.now() + 3000 }
      ]
    });
    ctx.audio.play({ frequency: 660, pitchDrop: 300, durationMs: 120, volume: 0.4 });
    return true;
  }
};
```

**Trigger zone** (detects a grabbable object or slot near a point):

```js
let every = 0;
return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    every -= dt; if (every > 0) return; every = 0.2;
    const here = ctx.self.getWorldPosition();
    const ball = ctx.world.findNear(here, 0.4).find(s => s.name === 'Ball');
    if (ball) {
      ctx.particles.burst({ color: '#facc15', count: 40, durationMs: 800 });
      // Puts the ball back; returns false (does nothing) while someone still holds it.
      ctx.world.setWorldPose(ball.id, { position: [0, 1, 4] });
    }
  }
};
```

**Shared score on a sign** (the scoring script owns the state in a `scriptState` on its own slot):

```js
function data() { return ctx.self.getComponent('scriptState').data; }
function addPoint() {
  const next = { ...data(), score: (data().score || 0) + 1 };
  ctx.world.setComponentField(ctx.self.id, 'scriptState', 'data', next);
  ctx.world.setComponentField('score-sign', 'textDisplay', 'lines', ['Score: ' + next.score]);
}
return { onPress() { if (ctx.world.isHost()) addPoint(); } };
```

---

## 9. Design guidelines

- Start every world with: a `skybox` root slot, a `ground` floor (with `collider`) under the origin, and something worth looking at in front of the start point (+Z).
- Build objects as groups: an unscaled `container` parent and scaled leaf shapes. Name every slot clearly.
- Give the world a readable layout: paths, zones, signs (`textDisplay`) that explain how to play ("Grab the ball and throw it into the hoop").
- Use walls with colliders to bound the playable area, or a large floor with clear edges.
- Interactive objects: `grabbable` + `collider` + a `meshRenderer` on the root or its parts. Put loose objects on table tops with a `dropZone` so they settle when released.
- Lights: a few `pointLight`s with warm/cool colours make a big difference; set `skybox.ambientIntensity` lower (0.4–0.7) for night scenes so lights stand out.
- Prefer many simple, correct pieces over clever code. Every script must be robust when several players are present (host checks).
- Size: aim for 50–400 slots. Hard limit 2000 slots and 1.5 MB of JSON.

---

## 10. Validation rules (hard limits)

The import is rejected if any of these fail:

1. The root is a **non-empty JSON array** of at most **2000** slots; the serialized JSON is under **1,500,000** characters.
2. Every slot has exactly: `id` (unique non-empty string, not `dash-panel`/`inspector-panel`), `parentId` (`null` or an existing id), `name` (string), `position` (3 finite numbers), `rotation` (4 finite numbers), `scale` (3 finite numbers), `components` (array). Optional `disabled`.
3. No parent cycles.
4. Every component has a known `type` (section 6) and all its required fields with the right JSON types: numbers are numbers (not `"2"`), booleans are `true`/`false`, enums are one of the listed strings, colours are `"#rrggbb"`.
5. `meshRenderer.meshRef` is `{ "kind": "builtin", "id": one of box, sphere, cylinder, plane, ground, disc }`.
6. `audioPlayer.source`, `material` maps and `appInfo.icon` are `{ "kind": "url", "url": "https://..." }` (URL ≤ 2048 characters).
7. Every `grabbable` has both `scalable` and `autoGrip` as booleans.
8. `equippable.left/right` and `socket.snap` are `{ "position": [3 numbers], "rotation": [3 numbers in degrees] }`.
9. Every `codeBlock.code` compiles as a function body and returns an object of handlers.

Self-check before answering:

- [ ] All ids unique; all `parentId`s exist.
- [ ] Every `grabbable` has `"scalable"` and `"autoGrip"`.
- [ ] Rotations are normalised quaternions; `equippable`/`socket` poses use Euler degrees.
- [ ] Floor (`ground`/`disc` + `collider`) under the origin; start area clear.
- [ ] Signs, panels and mirrors face the viewer (local +Z pointing away from them).
- [ ] `textDisplay`, `scoreboard`, `mirror`, `camera` slots have a `plane` `meshRenderer`; `uiPanel` slots have none.
- [ ] Parents that group things are unscaled `container`s.
- [ ] Scripts: host checks before changing the world, ids referenced in code exist, strings properly escaped in JSON.

---

## 11. Complete example

A small courtyard: sky, floor, a welcome sign, a table with a grabbable ball, a lamp with a push button and a target that celebrates when the ball touches it.

```json
[
  {
    "id": "sky", "parentId": null, "name": "Sky",
    "position": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1],
    "components": [{ "type": "skybox", "topColor": "#0b1030", "horizonColor": "#f59e0b", "bottomColor": "#1f2937", "stars": 0.4, "ambientIntensity": 0.8 }]
  },
  {
    "id": "floor", "parentId": null, "name": "Floor",
    "position": [0, 0, 4], "rotation": [0, 0, 0, 1], "scale": [1.5, 1, 1.5],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "ground" }, "color": "#3f4a3c" },
      { "type": "collider", "shape": "box" }
    ]
  },
  {
    "id": "welcome-sign", "parentId": null, "name": "Welcome Sign",
    "position": [0, 1.8, 9], "rotation": [0, 0, 0, 1], "scale": [2, 1, 1],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "plane" }, "color": "#111827" },
      { "type": "textDisplay", "title": "Courtyard", "lines": ["Grab the ball on the table", "and touch the golden target.", "Press the red button for light."], "color": "#111827" }
    ]
  },
  {
    "id": "table", "parentId": null, "name": "Table",
    "position": [0, 0, 5], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1],
    "components": [{ "type": "container" }]
  },
  {
    "id": "table-top", "parentId": "table", "name": "Table Top",
    "position": [0, 0.74, 0], "rotation": [0, 0, 0, 1], "scale": [1.4, 0.05, 0.8],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#8b5a2b" },
      { "type": "collider", "shape": "box" }
    ]
  },
  {
    "id": "table-leg-1", "parentId": "table", "name": "Table Leg 1",
    "position": [-0.62, 0.36, -0.32], "rotation": [0, 0, 0, 1], "scale": [0.06, 0.72, 0.06],
    "components": [{ "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#5b3a1c" }]
  },
  {
    "id": "table-leg-2", "parentId": "table", "name": "Table Leg 2",
    "position": [0.62, 0.36, -0.32], "rotation": [0, 0, 0, 1], "scale": [0.06, 0.72, 0.06],
    "components": [{ "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#5b3a1c" }]
  },
  {
    "id": "table-leg-3", "parentId": "table", "name": "Table Leg 3",
    "position": [-0.62, 0.36, 0.32], "rotation": [0, 0, 0, 1], "scale": [0.06, 0.72, 0.06],
    "components": [{ "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#5b3a1c" }]
  },
  {
    "id": "table-leg-4", "parentId": "table", "name": "Table Leg 4",
    "position": [0.62, 0.36, 0.32], "rotation": [0, 0, 0, 1], "scale": [0.06, 0.72, 0.06],
    "components": [{ "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#5b3a1c" }]
  },
  {
    "id": "table-drop-zone", "parentId": "table", "name": "Table Drop Zone",
    "position": [0, 0.96, 0], "rotation": [0, 0, 0, 1], "scale": [1.4, 0.4, 0.8],
    "components": [{ "type": "dropZone", "align": "upright" }]
  },
  {
    "id": "ball", "parentId": null, "name": "Ball",
    "position": [0.3, 0.88, 5], "rotation": [0, 0, 0, 1], "scale": [0.2, 0.2, 0.2],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "sphere" }, "color": "#ef4444" },
      { "type": "collider", "shape": "sphere" },
      { "type": "grabbable", "scalable": false, "autoGrip": true }
    ]
  },
  {
    "id": "target", "parentId": null, "name": "Target",
    "position": [2.5, 1.3, 6], "rotation": [0, 0, 0, 1], "scale": [0.35, 0.35, 0.35],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "sphere" }, "color": "#facc15" },
      { "type": "pointLight", "color": "#facc15", "intensity": 1, "range": 3 },
      { "type": "codeBlock", "code": "let cooldown = 0;\nreturn {\n  tick(dt) {\n    if (!ctx.world.isHost()) return;\n    cooldown -= dt;\n    if (cooldown > 0) return;\n    const here = ctx.self.getWorldPosition();\n    const ball = ctx.world.findNear(here, 0.35).find((s) => s.id === 'ball');\n    if (!ball) return;\n    cooldown = 1.5;\n    ctx.particles.burst({ color: '#facc15', count: 60, durationMs: 900 });\n    ctx.audio.play({ frequency: 880, pitchDrop: 200, durationMs: 250, volume: 0.6 });\n    ctx.world.setWorldPose('ball', { position: [0.3, 0.88, 5] });\n  }\n};" }
    ]
  },
  {
    "id": "lamp", "parentId": null, "name": "Lamp",
    "position": [-2, 0, 6], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1],
    "components": [{ "type": "container" }]
  },
  {
    "id": "lamp-post", "parentId": "lamp", "name": "Lamp Post",
    "position": [0, 1.1, 0], "rotation": [0, 0, 0, 1], "scale": [0.08, 2.2, 0.08],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "cylinder" }, "color": "#1f2937" },
      { "type": "collider", "shape": "box" }
    ]
  },
  {
    "id": "lamp-bulb", "parentId": "lamp", "name": "Lamp Bulb",
    "position": [0, 2.3, 0], "rotation": [0, 0, 0, 1], "scale": [0.3, 0.3, 0.3],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "sphere" }, "color": "#334155" },
      { "type": "pointLight", "color": "#fde68a", "intensity": 0, "range": 8 }
    ]
  },
  {
    "id": "lamp-button-base", "parentId": "lamp", "name": "Lamp Button Base",
    "position": [0.4, 0.5, 0], "rotation": [0, 0, 0, 1], "scale": [0.25, 1, 0.25],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "box" }, "color": "#374151" },
      { "type": "collider", "shape": "box" }
    ]
  },
  {
    "id": "lamp-button", "parentId": "lamp", "name": "Lamp Button",
    "position": [0.4, 1.03, 0], "rotation": [0, 0, 0, 1], "scale": [0.12, 0.05, 0.12],
    "components": [
      { "type": "meshRenderer", "meshRef": { "kind": "builtin", "id": "cylinder" }, "color": "#dc2626" },
      { "type": "pressableButton", "axis": [0, -1, 0], "travel": 0.025, "radius": 0.09 },
      { "type": "codeBlock", "code": "return {\n  onPress() {\n    if (!ctx.world.isHost()) return;\n    const bulb = ctx.hierarchy.getSlot('lamp-bulb');\n    const light = bulb && bulb.components.find((c) => c.type === 'pointLight');\n    if (!light) return;\n    const on = light.intensity === 0;\n    ctx.world.setComponentField('lamp-bulb', 'pointLight', 'intensity', on ? 3 : 0);\n    ctx.world.setComponentField('lamp-bulb', 'meshRenderer', 'color', on ? '#fde68a' : '#334155');\n    ctx.audio.play({ frequency: on ? 900 : 500, durationMs: 80, volume: 0.4 });\n  }\n};" }
    ]
  }
]
```

Notes: the `pressableButton` sits on the cap only (the cap moves down 2.5 cm when pushed; `travel` and `radius` are real metres), and its parent `lamp` is unscaled. The button is VR-only; a world meant for desktop players too would add a small UI panel with a "Light" button calling the same logic.

---

## 12. How to answer

1. If the request is ambiguous, make reasonable choices and state them in one or two lines after the JSON (do not ask unless something essential is missing).
2. Plan the layout first (zones, sizes in metres, where the player starts and looks).
3. Write the JSON array, then run the self-check list in section 10.
4. After the code block, give a short summary: what is in the world and how to interact with it.
