// The home-building tools of the Workshop: walls and rooms, floors, stairs, doors and windows, roofs, and a sledgehammer.
// Like a dollhouse builder, each points at the flat plane of the level being built (not at whatever is there), snaps to a
// half-metre grid and shows a see-through preview of what the trigger will build. Everything built is a child of one
// 'House' group, each piece (a wall, a floor, a staircase, a roof) with a `scriptState` saying what it is, so the tools
// can find, cut, rebuild and undo pieces. Used by workshop-tools.mjs, which adds the shared tool prelude to each script.

/** @param {number} radians */
const tilt = (radians) => [Math.sin(radians / 2), 0, 0, Math.cos(radians / 2)];
/** @param {number} radians */
const roll = (radians) => [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];

/** A door: swings open while someone stands near it and shuts once they have gone. Each player's device moves its own copy. */
const DOOR_SCRIPT = String.raw`
let angle = 0;
let open = false;
let wait = 0;
const isAvatar = (slot) => slot.components.some((c) => c.type === 'avatar');
return {
  tick(dt) {
    wait -= dt;
    if (wait <= 0) {
      wait = 0.25;
      open = ctx.world.findNear(ctx.self.getWorldPosition(), 1.8).some(isAvatar);
    }
    const target = open ? 1.45 : 0;
    angle += Math.max(-dt * 2.5, Math.min(dt * 2.5, target - angle));
    // Every frame, still or not: a snapshot from the host puts the hinge back where it was saved.
    ctx.self.setLocalTransform({ rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] });
  }
};
`;

/** Shared by every home tool's script, after the workshop prelude: the house, its pieces, previews, the grid and undo. */
export const HOME_PRELUDE = String.raw`
const V = ctx.math;
const H = 2.8;             // one storey: a wall's height, and how far apart the levels are
const GRID = 0.5;
const T = 0.15;            // wall thickness
const FLOOR_TOP = 0.02;    // a floor's surface above its level, so the ground under it never shows through
const SLAB = 0.12;         // an upper floor's thickness: the ceiling of the room below
const LEVELS = ['Ground', '1st floor', '2nd floor'];
const PREVIEW = '#38bdf8';
const BAD = '#ef4444';
const FRAME = '#f8fafc';
const CEILING = '#ece8e1';
const DOOR_SCRIPT = ${JSON.stringify(DOOR_SCRIPT.trim())};
let level = 0;

const snap = (v, step = GRID) => Math.round(v / step) * step;
const yawQuat = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const pitchQuat = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const uid = () => crypto.randomUUID();
const metres = (v) => Math.round(v * 100) / 100 + ' m';
const mesh = (id, color, opacity) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, color, ...(opacity === undefined ? {} : { opacity }) });
const SOLID = { type: 'collider', shape: 'box' };
// A box part, given by its centre and size in its piece's own space.
const block = (name, center, size, color, solid, rotation) => ({ name, position: center.map(round3), rotation: rotation || [0, 0, 0, 1], scale: size.map(round3), components: [mesh('box', color), ...(solid ? [SOLID] : [])] });
// A point given in a piece's own space, in the world.
const toWorld = (pose, local) => V.vecAdd(pose.position, V.rotateVec(pose.rotation, local));
const rectSize = (r) => [round3(r[2] - r[0]), round3(r[3] - r[1])];
// The rectangle [x0, z0, x1, z1] between two grid points.
const span = (a, b) => [Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2])].map(round3);

// --- The house ---------------------------------------------------------------------------------------------------------
const dataOf = (slot) => { const c = slot && slot.components.find((x) => x.type === 'scriptState'); return (c && c.data) || null; };
const isHouse = (slot) => !!slot && slot.name === 'House' && (dataOf(slot) || {}).kind === 'house';
function houseId(create) {
  const found = ctx.hierarchy.getChildren(null).find(isHouse);
  if (found || !create) return found ? found.id : null;
  const id = uid();
  ctx.world.spawn({ id, name: 'House', components: [{ type: 'container' }, { type: 'scriptState', data: { kind: 'house' } }] });
  return id;
}
// The piece of the house a slot belongs to (a wall, a floor, a staircase, a roof), or null.
function pieceOf(slotId) {
  for (let slot = ctx.hierarchy.getSlot(slotId), hops = 0; slot && hops < 16; hops++) {
    const parent = slot.parentId ? ctx.hierarchy.getSlot(slot.parentId) : null;
    if (isHouse(parent)) return dataOf(slot) ? slot : null;
    slot = parent;
  }
  return null;
}
function piecesOf(kind, onLevel) {
  const house = houseId(false);
  if (!house) return [];
  return ctx.hierarchy.getChildren(house).filter((slot) => {
    const data = dataOf(slot);
    return data && data.kind === kind && (onLevel === undefined || data.level === onLevel);
  });
}
// Spawns a piece (a slot with its parts, and theirs) in the house; returns its id.
function spawnPiece(piece) {
  const out = [];
  (function walk(parentId, list) {
    for (const { children, ...slot } of list) {
      const id = slot.id || uid();
      out.push({ ...slot, id, parentId });
      if (children) walk(id, children);
    }
  })(houseId(true), [piece]);
  for (const slot of out) ctx.world.spawn(slot);
  return out[0].id;
}
// Copies of a slot and everything below it, parents first.
function snapshot(rootId) {
  const out = [];
  const queue = [rootId];
  while (queue.length) {
    const slot = ctx.hierarchy.getSlot(queue.shift());
    if (!slot) continue;
    out.push(JSON.parse(JSON.stringify(slot)));
    for (const child of ctx.hierarchy.getChildren(slot.id)) queue.push(child.id);
  }
  return out;
}

// --- Undo: what one use of a tool did, the pieces it added and copies of those it took away -------------------------------
const history = [];
const begin = () => ({ added: [], removed: [] });
function addPiece(piece, action) { action.added.push(spawnPiece(piece)); }
function removePiece(id, action) { action.removed.push(snapshot(id)); ctx.world.deleteSlot(id); }
function commit(action) {
  if (!action.added.length && !action.removed.length) return;
  history.push(action);
  if (history.length > 40) history.shift();
}
function undo() {
  const action = history.pop();
  if (!action) return false;
  for (const id of action.added) if (ctx.hierarchy.getSlot(id)) ctx.world.deleteSlot(id);
  const house = houseId(true);
  for (const slots of action.removed) {
    if (!slots.length || ctx.hierarchy.getSlot(slots[0].id)) continue;
    slots.forEach((slot, i) => ctx.world.spawn(i === 0 ? { ...slot, parentId: house } : slot));
  }
  return true;
}

// --- Previews: see-through boxes of what the trigger would build, moved every frame, shown to others a few times a second --
const previews = new Map();
let previewsUsed = new Set();
function preview(key, color, pose) {
  previewsUsed.add(key);
  const position = pose.position.map(round3), scale = pose.scale.map(round3), rotation = pose.rotation;
  let p = previews.get(key);
  if (p && !ctx.hierarchy.getSlot(p.id)) { previews.delete(key); p = null; }
  if (!p) {
    const id = uid();
    ctx.world.spawn({ id, name: 'Build Preview', position, rotation, scale, components: [mesh('box', color, 0.4)] });
    previews.set(key, { id, color, shown: true, sig: '', dirty: false, synced: Date.now() });
    return;
  }
  if (!p.shown) { ctx.world.setSlotEnabled(p.id, true); p.shown = true; }
  if (p.color !== color) { p.color = color; ctx.world.setComponentField(p.id, 'meshRenderer', 'color', color); }
  const sig = JSON.stringify([position, rotation.map((v) => Math.round(v * 1e4)), scale]);
  if (sig === p.sig) return;
  p.sig = sig;
  p.dirty = true;
  ctx.world.setWorldPose(p.id, { position, rotation, scale }, false);
}
// Call once a frame, after the previews of that frame: hides the ones not wanted any more and shares the moved ones.
function previewsDone() {
  const now = Date.now();
  for (const [key, p] of previews) {
    if (!previewsUsed.has(key) && p.shown) { ctx.world.setSlotEnabled(p.id, false); p.shown = false; }
    if (p.dirty && now - p.synced > 150) { p.dirty = false; p.synced = now; ctx.world.setWorldPose(p.id, {}, true); }
  }
  previewsUsed = new Set();
}
function clearPreviews() {
  for (const p of previews.values()) ctx.world.deleteSlot(p.id);
  previews.clear();
  previewsUsed = new Set();
}
const previewIds = () => [...previews.values()].map((p) => p.id);

// --- The grid: a patch of half-metre squares round the point aimed at, on the level being built -----------------------------
let gridId = null;
let gridAt = '';
let gridSynced = 0;
function showGrid(center) {
  if (gridId && !ctx.hierarchy.getSlot(gridId)) gridId = null;
  const key = center.join(',');
  if (gridId && key === gridAt) return;
  gridAt = key;
  const R = 2, n = Math.round((2 * R) / GRID), y = center[1] + FLOOR_TOP + 0.01;
  const [cx, , cz] = center;
  const points = [];
  // One line, back and forth across the patch: first along X, then along Z (the turns run along its border).
  for (let i = 0; i <= n; i++) {
    const z = cz - R + i * GRID;
    const [a, b] = i % 2 ? [cx + R, cx - R] : [cx - R, cx + R];
    points.push(a, y, z, b, y, z);
  }
  for (let i = 0; i <= n; i++) {
    const x = cx + R - i * GRID;
    const [a, b] = i % 2 ? [cz - R, cz + R] : [cz + R, cz - R];
    points.push(x, y, a, x, y, b);
  }
  const rounded = points.map(round3);
  if (!gridId) {
    gridId = uid();
    ctx.world.spawn({ id: gridId, name: 'Build Grid', components: [{ type: 'stroke', points: rounded, color: '#e2e8f0', width: 0.006 }] });
    gridSynced = Date.now();
    return;
  }
  const now = Date.now();
  const broadcast = now - gridSynced > 150;
  if (broadcast) gridSynced = now;
  ctx.world.setComponentField(gridId, 'stroke', 'points', rounded, broadcast);
}
function hideGrid() { if (gridId) ctx.world.deleteSlot(gridId); gridId = null; gridAt = ''; }

// --- Aiming ------------------------------------------------------------------------------------------------------------
// Where the tool points on the level being built: the ray meets that level's flat plane, as in a dollhouse view.
function aimLevel() {
  const muzzle = partPose('Muzzle');
  if (!muzzle) return null;
  const y = level * H, d = muzzle.forward;
  if (Math.abs(d[1]) < 1e-4) return null;
  const t = (y - muzzle.position[1]) / d[1];
  if (t <= 0 || t > 30) return null;
  const point = V.vecAdd(muzzle.position, V.vecScale(d, t));
  return { from: muzzle.position, forward: d, point, grid: [round3(snap(point[0])), y, round3(snap(point[2]))] };
}
// What the tool points at in the world, looking past its own previews.
function aimThrough() {
  const muzzle = partPose('Muzzle');
  if (!muzzle) return null;
  const hit = ctx.world.raycast(muzzle.position, muzzle.forward, REACH, { ignore: [SELF, ...previewIds(), ...(gridId ? [gridId] : [])] });
  return { from: muzzle.position, forward: muzzle.forward, hit, end: hit ? hit.point : V.vecAdd(muzzle.position, V.vecScale(muzzle.forward, 2)) };
}

let shownText = '';
function readout(title, lines) {
  const key = JSON.stringify([title, lines]);
  if (key === shownText) return;
  shownText = key;
  const r = part('Readout');
  if (!r) return;
  ctx.world.setComponentField(r.id, 'textDisplay', 'title', title, false);
  ctx.world.setComponentField(r.id, 'textDisplay', 'lines', lines, false);
}
const levelItem = () => ({ label: 'Level: ' + LEVELS[level], isEnabled: () => true, onSelect: () => { level = (level + 1) % LEVELS.length; } });
const undoItem = () => ({ label: 'Undo', isEnabled: () => history.length > 0, onSelect: () => { if (undo()) beep(420); } });
function stopBuilding() { clearPreviews(); hideGrid(); }

// --- Walls, with their doors and windows ---------------------------------------------------------------------------------
// A wall from a to b on a level: a group at its middle, turned so that its X runs along the wall.
function wallPiece(a, b, onLevel, color) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  return wallFromData({ kind: 'wall', level: onLevel, at: [(a[0] + b[0]) / 2, onLevel * H, (a[2] + b[2]) / 2].map(round3), yaw: Math.atan2(-dz, dx), length: round3(Math.hypot(dx, dz)), color, openings: [] });
}
// Builds a wall again from what it is: the sections round its openings, and what fills each one.
function wallFromData(data) {
  const half = data.length / 2 + T / 2; // each end runs on into the corner, closing it where walls meet
  const parts = [];
  let x = -half;
  for (const o of data.openings.slice().sort((p, q) => p.x - q.x)) {
    const x0 = o.x - o.width / 2, x1 = o.x + o.width / 2;
    if (x0 - x > 0.001) parts.push(block('Wall Section', [(x + x0) / 2, H / 2, 0], [x0 - x, H, T], data.color, true));
    if (o.bottom > 0) parts.push(block('Wall Section', [o.x, o.bottom / 2, 0], [o.width, o.bottom, T], data.color, true));
    if (o.top < H) parts.push(block('Wall Section', [o.x, (o.top + H) / 2, 0], [o.width, H - o.top, T], data.color, true));
    parts.push(...openingParts(o));
    x = x1;
  }
  if (half - x > 0.001) parts.push(block('Wall Section', [(x + half) / 2, H / 2, 0], [half - x, H, T], data.color, true));
  return {
    name: 'Wall',
    position: data.at,
    rotation: yawQuat(data.yaw),
    components: [{ type: 'container' }, { type: 'scriptState', data: { ...data, box: [0, H / 2, 0, data.length + T, H, T] } }],
    children: parts
  };
}
const FW = 0.07; // frame width
function openingParts(o) {
  const { x, width: w, bottom: b, top: t } = o;
  const depth = T + 0.03, middle = (b + t) / 2;
  const out = [
    block('Frame', [x - w / 2 + FW / 2, middle, 0], [FW, t - b, depth], FRAME),
    block('Frame', [x + w / 2 - FW / 2, middle, 0], [FW, t - b, depth], FRAME),
    block('Frame', [x, t - FW / 2, 0], [w, FW, depth], FRAME)
  ];
  if (b > 0) out.push(block('Sill', [x, b + FW / 4, 0], [w + 0.08, FW / 2, depth + 0.08], FRAME));
  if (o.kind === 'window') {
    out.push({ name: 'Glass', position: [x, middle, 0].map(round3), scale: [w - 2 * FW, t - b - 2 * FW, 0.02].map(round3), components: [mesh('box', '#bfe3f5', 0.3)] });
    out.push(block('Mullion', [x, middle, 0], [0.035, t - b - 2 * FW, 0.04], FRAME));
  }
  if (o.kind === 'door') {
    const leaf = w - 2 * FW, high = t - FW;
    // Hinged at one side of the frame: the door's own script turns the hinge.
    out.push({
      name: 'Door Hinge',
      position: [x - w / 2 + FW, 0, 0].map(round3),
      components: [{ type: 'codeBlock', code: DOOR_SCRIPT }],
      children: [
        block('Door', [leaf / 2, high / 2, 0], [leaf, high, 0.045], '#8b5e3c'),
        { name: 'Door Knob', position: [leaf - 0.08, 1, -0.04].map(round3), scale: [0.05, 0.05, 0.05], components: [mesh('sphere', '#d4a017')] },
        { name: 'Door Knob', position: [leaf - 0.08, 1, 0.04].map(round3), scale: [0.05, 0.05, 0.05], components: [mesh('sphere', '#d4a017')] }
      ]
    });
  }
  return out;
}

// --- Floors: rectangles on a level, cut round the stairwells -----------------------------------------------------------
function floorPiece(rect, onLevel, color) {
  const [w, d] = rectSize(rect);
  return {
    name: 'Floor',
    position: [(rect[0] + rect[2]) / 2, onLevel * H + FLOOR_TOP, (rect[1] + rect[3]) / 2].map(round3),
    // A ground mesh is 20 m across.
    scale: [w / 20, 1, d / 20].map((v) => Math.round(v * 1e5) / 1e5),
    components: [mesh('ground', color), SOLID, { type: 'scriptState', data: { kind: 'floor', level: onLevel, rect, color, box: [0, -SLAB / 2, 0, w, SLAB + 0.02, d] } }],
    // An upper floor is also the ceiling of the room below it.
    children: onLevel > 0 ? [{ name: 'Ceiling', position: [0, -SLAB / 2 - 0.004, 0], scale: [20, SLAB, 20], components: [mesh('box', CEILING)] }] : []
  };
}
const E = 1e-6;
const overlaps = (a, b) => b[0] < a[2] - E && b[2] > a[0] + E && b[1] < a[3] - E && b[3] > a[1] + E;
// What is left of rectangle a outside rectangle b: up to four rectangles.
function subtract(a, b) {
  if (!overlaps(a, b)) return [a];
  const out = [];
  if (b[1] > a[1] + E) out.push([a[0], a[1], a[2], b[1]]);
  if (b[3] < a[3] - E) out.push([a[0], b[3], a[2], a[3]]);
  const z0 = Math.max(a[1], b[1]), z1 = Math.min(a[3], b[3]);
  if (b[0] > a[0] + E) out.push([a[0], z0, b[0], z1]);
  if (b[2] < a[2] - E) out.push([b[2], z0, a[2], z1]);
  return out.map((r) => r.map(round3));
}
// The openings in a level's floor left for the stairs coming up from the level below.
const stairwells = (onLevel) => piecesOf('stairs', onLevel - 1).map((stairs) => dataOf(stairs).rect);
// Takes a rectangle out of a level's floors, keeping the rest of them.
function cutFloors(hole, onLevel, action) {
  for (const old of piecesOf('floor', onLevel)) {
    const data = dataOf(old);
    if (!overlaps(data.rect, hole)) continue;
    removePiece(old.id, action);
    for (const rest of subtract(data.rect, hole)) addPiece(floorPiece(rest, onLevel, data.color), action);
  }
}
// Lays a floor over what was there (so a floor can be laid again in another finish), leaving the stairwells open.
function layFloor(rect, onLevel, color, action) {
  cutFloors(rect, onLevel, action);
  let parts = [rect];
  for (const hole of stairwells(onLevel)) parts = parts.flatMap((r) => subtract(r, hole));
  for (const r of parts) addPiece(floorPiece(r, onLevel, color), action);
}
`;

// --- The tools --------------------------------------------------------------------------------------------------------

const WALL_TOOL = String.raw`
const SHAPES = ['Wall', 'Room'];
const PAINTS = [['White', '#f4f1ea'], ['Cream', '#efe2c4'], ['Sage', '#a9b79a'], ['Sky', '#b9d3e6'], ['Blush', '#e8c4b8'], ['Terracotta', '#c2714f'], ['Brick', '#9a4031'], ['Charcoal', '#45474d']];
const ROOM_FLOOR = '#b07d4f';
let shape = 0, paint = 0;
let start = null, end = null;

// The far end of a wall dragged from a towards p: along the grid or at 45°, a whole number of squares long.
function wallEnd(a, p) {
  const dx = p[0] - a[0], dz = p[2] - a[2];
  if (Math.hypot(dx, dz) < GRID / 2) return a;
  const angle = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const ux = Math.round(Math.cos(angle)), uz = Math.round(Math.sin(angle));
  const steps = Math.max(0, Math.round((dx * ux + dz * uz) / ((ux && uz ? 2 : 1) * GRID)));
  return [round3(a[0] + ux * steps * GRID), a[1], round3(a[2] + uz * steps * GRID)];
}
// The walls the drag would build: one, or the four round a room.
function segments() {
  if (!start || !end || (end[0] === start[0] && end[2] === start[2])) return [];
  if (SHAPES[shape] === 'Wall') return [[start, end]];
  const [x0, z0, x1, z1] = span(start, end), y = start[1];
  if (x1 - x0 < GRID / 2 || z1 - z0 < GRID / 2) return [[[x0, y, z0], [x1, y, z1]]];
  return [[[x0, y, z0], [x1, y, z0]], [[x1, y, z0], [x1, y, z1]], [[x1, y, z1], [x0, y, z1]], [[x0, y, z1], [x0, y, z0]]];
}
const lengthOf = ([a, b]) => Math.hypot(b[0] - a[0], b[2] - a[2]);
function wallPose([a, b]) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  return { position: [(a[0] + b[0]) / 2, a[1] + H / 2, (a[2] + b[2]) / 2], rotation: yawQuat(Math.atan2(-dz, dx)), scale: [Math.hypot(dx, dz) + T, H, T] };
}
function stop() { start = end = null; stopBuilding(); }

const tool = {
  onDrop: stop,
  onUnequip: stop,
  onTrigger(e) {
    if (e.phase === 'press') {
      const at = aimLevel();
      if (!at) { buzz(); return true; }
      start = end = at.grid;
      beep(520);
      return true;
    }
    if (e.phase !== 'release' || !start) return true;
    const walls = segments();
    const room = SHAPES[shape] === 'Room' && walls.length === 4 ? span(start, end) : null;
    start = end = null;
    if (!walls.length) return true;
    const action = begin();
    for (const [a, b] of walls) addPiece(wallPiece(a, b, level, PAINTS[paint][1]), action);
    if (room) layFloor(room, level, ROOM_FLOOR, action);
    commit(action);
    flash(walls[0][1], PREVIEW);
    beep(760);
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const at = aimLevel();
    if (at) {
      showBeam(at.from, at.point, PREVIEW);
      showGrid(at.grid);
      if (start) end = SHAPES[shape] === 'Wall' ? wallEnd(start, at.point) : at.grid;
    } else hideBeam();
    const walls = segments();
    if (!walls.length && at) preview('cursor', PREVIEW, { position: [at.grid[0], at.grid[1] + H / 2, at.grid[2]], rotation: [0, 0, 0, 1], scale: [T, H, T] });
    walls.forEach((wall, i) => preview('wall' + i, PAINTS[paint][1], wallPose(wall)));
    previewsDone();
    const total = walls.reduce((sum, wall) => sum + lengthOf(wall), 0);
    readout(SHAPES[shape] === 'Wall' ? 'Wall Tool' : 'Room', [LEVELS[level], start ? metres(total) : 'Hold trigger, drag']);
  },
  getRadialItems() {
    return [
      { label: 'Draw: ' + SHAPES[shape], isEnabled: () => true, onSelect: () => { shape = (shape + 1) % SHAPES.length; } },
      { label: 'Paint: ' + PAINTS[paint][0], isEnabled: () => true, onSelect: () => { paint = (paint + 1) % PAINTS.length; } },
      levelItem(),
      undoItem()
    ];
  }
};
`;

const FLOOR_TOOL = String.raw`
const FINISHES = [['Oak', '#b07d4f'], ['Walnut', '#6b4430'], ['Tile', '#d9d4cc'], ['Marble', '#eceae4'], ['Slate', '#5b6170'], ['Carpet', '#8c3b3b'], ['Grass', '#5a8f3c']];
let finish = 0;
let start = null, end = null;

// Floors are laid square by square: the squares between the one pressed on and the one let go over.
const cell = (p) => [Math.floor(p[0] / GRID), Math.floor(p[2] / GRID)];
const cellsRect = (a, b) => [Math.min(a[0], b[0]) * GRID, Math.min(a[1], b[1]) * GRID, (Math.max(a[0], b[0]) + 1) * GRID, (Math.max(a[1], b[1]) + 1) * GRID].map(round3);
function rectPose(rect) {
  const [w, d] = rectSize(rect);
  return { position: [(rect[0] + rect[2]) / 2, level * H + FLOOR_TOP, (rect[1] + rect[3]) / 2], rotation: [0, 0, 0, 1], scale: [w, 0.05, d] };
}
function stop() { start = end = null; stopBuilding(); }

const tool = {
  onDrop: stop,
  onUnequip: stop,
  onTrigger(e) {
    if (e.phase === 'press') {
      const at = aimLevel();
      if (!at) { buzz(); return true; }
      start = end = cell(at.point);
      beep(520);
      return true;
    }
    if (e.phase !== 'release' || !start) return true;
    const rect = cellsRect(start, end);
    start = end = null;
    const action = begin();
    layFloor(rect, level, FINISHES[finish][1], action);
    commit(action);
    flash([(rect[0] + rect[2]) / 2, level * H + FLOOR_TOP, (rect[1] + rect[3]) / 2], FINISHES[finish][1]);
    beep(760);
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const at = aimLevel();
    if (at) {
      showBeam(at.from, at.point, PREVIEW);
      showGrid(at.grid);
      if (start) end = cell(at.point);
    } else hideBeam();
    const rect = start ? cellsRect(start, end) : at ? cellsRect(cell(at.point), cell(at.point)) : null;
    if (rect) preview('floor', FINISHES[finish][1], rectPose(rect));
    previewsDone();
    const [w, d] = rect ? rectSize(rect) : [0, 0];
    readout('Floor Tool', [LEVELS[level], start ? metres(w) + ' × ' + metres(d) : 'Hold trigger, drag']);
  },
  getRadialItems() {
    return [
      { label: 'Finish: ' + FINISHES[finish][0], isEnabled: () => true, onSelect: () => { finish = (finish + 1) % FINISHES.length; } },
      levelItem(),
      undoItem()
    ];
  }
};
`;

const STAIRS_TOOL = String.raw`
const WOODS = [['Oak', '#b07d4f'], ['Walnut', '#6b4430'], ['White', '#e9e5dc'], ['Stone', '#9ca3af']];
const STEPS = 16, RUN = 0.25, WIDTH = 1;
const LENGTH = STEPS * RUN;
const SLOPE = Math.atan2(H, LENGTH);
let wood = 0;

// Stairs from the grid point aimed at, going up the way the tool points (the nearest of the four grid directions).
function stairsAt(at) {
  const yaw = Math.round(Math.atan2(at.forward[0], at.forward[2]) / (Math.PI / 2)) * (Math.PI / 2);
  const dir = [Math.round(Math.sin(yaw)), Math.round(Math.cos(yaw))];
  const [x, y, z] = at.grid;
  const far = [x + dir[0] * LENGTH, z + dir[1] * LENGTH];
  const rect = dir[0]
    ? [Math.min(x, far[0]), z - WIDTH / 2, Math.max(x, far[0]), z + WIDTH / 2]
    : [x - WIDTH / 2, Math.min(z, far[1]), x + WIDTH / 2, Math.max(z, far[1])];
  return { at: [x, y, z], yaw, rect: rect.map(round3) };
}
function stairsPiece(s, onLevel, color) {
  const rise = H / STEPS, slant = Math.hypot(H, LENGTH);
  const parts = [];
  for (let i = 0; i < STEPS; i++) {
    const top = (i + 1) * rise + FLOOR_TOP;
    parts.push(block('Step', [0, top / 2, (i + 0.5) * RUN], [WIDTH, top, RUN], color));
  }
  // What is walked on: a ramp along the noses of the steps, unseen, so that feet glide up and down instead of bumping.
  parts.push({
    name: 'Stairs Walkway',
    position: [0, H / 2 + FLOOR_TOP, LENGTH / 2].map(round3),
    rotation: pitchQuat(-SLOPE),
    scale: [WIDTH / 20, 1, slant / 20].map((v) => Math.round(v * 1e5) / 1e5),
    components: [mesh('ground', color, 0), SOLID]
  });
  for (const side of [-1, 1]) {
    const x = side * (WIDTH / 2 - 0.04);
    parts.push(block('Handrail', [x, H / 2 + FLOOR_TOP + 0.9, LENGTH / 2], [0.05, 0.05, slant], '#3f3f46', false, pitchQuat(-SLOPE)));
    for (const z of [0.2, LENGTH / 2, LENGTH - 0.2]) {
      const foot = FLOOR_TOP + (H * z) / LENGTH;
      parts.push({ name: 'Baluster', position: [x, foot + 0.45, z].map(round3), scale: [0.035, 0.9, 0.035], components: [mesh('cylinder', '#3f3f46')] });
    }
  }
  return {
    name: 'Stairs',
    position: [s.at[0], onLevel * H, s.at[2]].map(round3),
    rotation: yawQuat(s.yaw),
    components: [{ type: 'container' }, { type: 'scriptState', data: { kind: 'stairs', level: onLevel, rect: s.rect, box: [0, H / 2, LENGTH / 2, WIDTH, H + 0.1, LENGTH] } }],
    children: parts
  };
}
const canGoUp = () => level < LEVELS.length - 1;

const tool = {
  onDrop: stopBuilding,
  onUnequip: stopBuilding,
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const at = aimLevel();
    if (!at || !canGoUp()) { buzz(); return true; }
    const s = stairsAt(at);
    const action = begin();
    addPiece(stairsPiece(s, level, WOODS[wood][1]), action);
    // The floor above opens where the stairs come up through it.
    cutFloors(s.rect, level + 1, action);
    commit(action);
    flash(at.point, PREVIEW);
    beep(760);
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const at = aimLevel();
    if (!at) {
      hideBeam();
      previewsDone();
      readout('Stairs', [LEVELS[level], 'Point at the floor']);
      return;
    }
    showBeam(at.from, at.point, PREVIEW);
    showGrid(at.grid);
    const s = stairsAt(at);
    const color = canGoUp() ? WOODS[wood][1] : BAD;
    const pose = { position: s.at, rotation: yawQuat(s.yaw) };
    preview('ramp', color, { position: toWorld(pose, [0, H / 2 + FLOOR_TOP, LENGTH / 2]), rotation: V.quatMultiply(pose.rotation, pitchQuat(-SLOPE)), scale: [WIDTH, 0.25, Math.hypot(H, LENGTH)] });
    preview('foot', color, { position: [(s.rect[0] + s.rect[2]) / 2, s.at[1] + FLOOR_TOP + 0.02, (s.rect[1] + s.rect[3]) / 2], rotation: [0, 0, 0, 1], scale: [s.rect[2] - s.rect[0], 0.04, s.rect[3] - s.rect[1]] });
    previewsDone();
    readout('Stairs', [canGoUp() ? LEVELS[level] + ' to ' + LEVELS[level + 1] : LEVELS[level], canGoUp() ? 'Point the way up' : 'No level above']);
  },
  getRadialItems() {
    return [
      { label: 'Wood: ' + WOODS[wood][0], isEnabled: () => true, onSelect: () => { wood = (wood + 1) % WOODS.length; } },
      levelItem(),
      undoItem()
    ];
  }
};
`;

const DOOR_WINDOW_TOOL = String.raw`
const ITEMS = [
  ['Door', { kind: 'door', width: 1, bottom: 0, top: 2.1 }],
  ['Window', { kind: 'window', width: 1, bottom: 0.9, top: 2.1 }],
  ['Wide window', { kind: 'window', width: 2, bottom: 0.9, top: 2.1 }],
  ['Tall window', { kind: 'window', width: 1, bottom: 0.3, top: 2.3 }],
  ['Archway', { kind: 'arch', width: 1.5, bottom: 0, top: 2.3 }]
];
let item = 0;

// Where the opening would go in the wall aimed at: centred on the spot in quarter-metre steps, clear of the wall's ends,
// and whether it fits there (it may not overlap another opening).
function placement(shot) {
  const wall = shot && shot.hit ? pieceOf(shot.hit.slotId) : null;
  const data = dataOf(wall);
  if (!data || data.kind !== 'wall') return null;
  const pose = ctx.hierarchy.getWorldPose(wall.id);
  const spec = ITEMS[item][1];
  const room = data.length / 2 - spec.width / 2 - 0.05; // how far from the middle the opening's centre may go
  const limit = Math.max(0, Math.floor(room / 0.25 + 1e-6) * 0.25);
  const along = V.vecDot(V.vecSub(shot.hit.point, pose.position), pose.right);
  const x = round3(Math.max(-limit, Math.min(limit, snap(along, 0.25))));
  const fits = room >= 0 && data.openings.every((o) => Math.abs(o.x - x) >= (o.width + spec.width) / 2 + 0.05 - 1e-6);
  return { wall, data, pose, opening: { ...spec, x }, fits };
}

const tool = {
  onDrop: stopBuilding,
  onUnequip: stopBuilding,
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const shot = aimThrough();
    const place = placement(shot);
    if (!place || !place.fits) { buzz(); return true; }
    const action = begin();
    removePiece(place.wall.id, action);
    addPiece(wallFromData({ ...place.data, openings: [...place.data.openings, place.opening] }), action);
    commit(action);
    flash(shot.hit.point, PREVIEW);
    beep(760);
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const shot = aimThrough();
    if (!shot) return;
    const place = placement(shot);
    showBeam(shot.from, shot.end, place ? (place.fits ? PREVIEW : BAD) : '#94a3b8');
    if (place) {
      const o = place.opening;
      preview('opening', place.fits ? PREVIEW : BAD, { position: toWorld(place.pose, [o.x, (o.bottom + o.top) / 2, 0]), rotation: place.pose.rotation, scale: [o.width, o.top - o.bottom, T + 0.08] });
    }
    previewsDone();
    readout('Doors & Windows', [ITEMS[item][0], place ? (place.fits ? 'Trigger: put it in' : 'No room here') : 'Point at a wall']);
  },
  getRadialItems() {
    return [
      { label: 'Item: ' + ITEMS[item][0], isEnabled: () => true, onSelect: () => { item = (item + 1) % ITEMS.length; } },
      undoItem()
    ];
  }
};
`;

const ROOF_TOOL = String.raw`
const ROOFS = [['Red tiles', '#a3402f'], ['Slate', '#3f4756'], ['Brown', '#6b4a32'], ['Green', '#3f6b45']];
const PITCH = (35 * Math.PI) / 180;
const EAVE = 0.3;        // how far the roof reaches past the walls
const THICK = 0.12;
const STRIPS = 8;        // the triangle of wall under each end of the roof, built up in courses
const GABLE = '#efe9dc';
let roof = 0;
let start = null, end = null;

// A gable roof over a rectangle whose corners are on the grid (as walls are), resting on the walls of a level.
// Its ridge runs along the longer side; in the roof's own space X runs along the ridge.
function roofShape(rect, onLevel) {
  const [w, d] = rectSize(rect);
  const half = Math.min(w, d) / 2;
  return { at: [(rect[0] + rect[2]) / 2, (onLevel + 1) * H, (rect[1] + rect[3]) / 2].map(round3), yaw: w >= d ? 0 : Math.PI / 2, length: Math.max(w, d), half, rise: half * Math.tan(PITCH) };
}
// Its two sides, in its own space.
function slopes(r) {
  const run = r.half + EAVE, slant = run / Math.cos(PITCH);
  return [1, -1].map((side) => ({
    center: [0, r.rise - (run / 2) * Math.tan(PITCH) + THICK / 2 / Math.cos(PITCH), (side * run) / 2],
    rotation: pitchQuat(side * PITCH),
    size: [r.length + 2 * EAVE, THICK, slant]
  }));
}
function roofPiece(rect, onLevel, color) {
  const r = roofShape(rect, onLevel);
  const parts = slopes(r).map((s) => block('Roof Side', s.center, s.size, color, false, s.rotation));
  parts.push(block('Ridge', [0, r.rise + THICK * 0.9, 0], [r.length + 2 * EAVE, 0.08, 0.18], color));
  for (let k = 0; k < STRIPS; k++) {
    const y0 = (k * r.rise) / STRIPS, y1 = ((k + 1) * r.rise) / STRIPS;
    const across = 2 * r.half * (1 - (k + 0.5) / STRIPS);
    for (const side of [-1, 1]) parts.push(block('Gable', [(side * r.length) / 2, (y0 + y1) / 2, 0], [T, y1 - y0 + 0.004, across], GABLE));
  }
  return {
    name: 'Roof',
    position: r.at,
    rotation: yawQuat(r.yaw),
    components: [{ type: 'container' }, { type: 'scriptState', data: { kind: 'roof', level: onLevel, rect, box: [0, r.rise / 2, 0, r.length + 2 * EAVE, r.rise + 0.3, 2 * (r.half + EAVE)] } }],
    children: parts
  };
}
function rect() {
  if (!start || !end) return null;
  const r = span(start, end);
  return r[2] - r[0] > GRID / 2 && r[3] - r[1] > GRID / 2 ? r : null;
}
function stop() { start = end = null; stopBuilding(); }

const tool = {
  onDrop: stop,
  onUnequip: stop,
  onTrigger(e) {
    if (e.phase === 'press') {
      const at = aimLevel();
      if (!at) { buzz(); return true; }
      start = end = at.grid;
      beep(520);
      return true;
    }
    if (e.phase !== 'release' || !start) return true;
    const over = rect();
    start = end = null;
    if (!over) { buzz(); return true; }
    const action = begin();
    addPiece(roofPiece(over, level, ROOFS[roof][1]), action);
    commit(action);
    flash(roofShape(over, level).at, ROOFS[roof][1]);
    beep(760);
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const at = aimLevel();
    if (at) {
      showBeam(at.from, at.point, PREVIEW);
      showGrid(at.grid);
      if (start) end = at.grid;
    } else hideBeam();
    const over = rect();
    if (over) {
      const r = roofShape(over, level);
      const pose = { position: r.at, rotation: yawQuat(r.yaw) };
      slopes(r).forEach((s, i) => preview('side' + i, ROOFS[roof][1], { position: toWorld(pose, s.center), rotation: V.quatMultiply(pose.rotation, s.rotation), scale: s.size }));
    } else if (at) {
      // Where a corner of the roof would be, at the height of the walls' tops.
      preview('corner', ROOFS[roof][1], { position: [at.grid[0], (level + 1) * H, at.grid[2]], rotation: [0, 0, 0, 1], scale: [0.25, 0.08, 0.25] });
    }
    previewsDone();
    const size = over ? rectSize(over) : null;
    readout('Roof Tool', ['On ' + LEVELS[level] + ' walls', size ? metres(size[0]) + ' × ' + metres(size[1]) : 'Drag corner to corner']);
  },
  getRadialItems() {
    return [
      { label: 'Roof: ' + ROOFS[roof][0], isEnabled: () => true, onSelect: () => { roof = (roof + 1) % ROOFS.length; } },
      levelItem(),
      undoItem()
    ];
  }
};
`;

const SLEDGEHAMMER = String.raw`
const NAMES = { wall: 'Wall', floor: 'Floor', stairs: 'Stairs', roof: 'Roof', door: 'Door', window: 'Window', arch: 'Archway' };

// The piece of the house aimed at, and, on a wall, the door or window aimed at if any (only that is knocked out).
function target(shot) {
  const piece = shot && shot.hit ? pieceOf(shot.hit.slotId) : null;
  if (!piece) return null;
  const data = dataOf(piece);
  const pose = ctx.hierarchy.getWorldPose(piece.id);
  let opening = null;
  if (data.kind === 'wall') {
    const along = V.vecDot(V.vecSub(shot.hit.point, pose.position), pose.right);
    const up = shot.hit.point[1] - pose.position[1];
    opening = data.openings.find((o) => Math.abs(along - o.x) <= o.width / 2 + 0.02 && up >= o.bottom - 0.02 && up <= o.top + 0.02) || null;
  }
  return { piece, data, pose, opening };
}
function outline(t) {
  if (t.opening) {
    const o = t.opening;
    return { position: toWorld(t.pose, [o.x, (o.bottom + o.top) / 2, 0]), rotation: t.pose.rotation, scale: [o.width + 0.06, o.top - o.bottom + 0.06, T + 0.1] };
  }
  const b = t.data.box;
  return { position: toWorld(t.pose, [b[0], b[1], b[2]]), rotation: t.pose.rotation, scale: [b[3] + 0.06, b[4] + 0.06, b[5] + 0.06] };
}

const tool = {
  onDrop: stopBuilding,
  onUnequip: stopBuilding,
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const shot = aimThrough();
    const t = target(shot);
    if (!t) { buzz(); return true; }
    const action = begin();
    removePiece(t.piece.id, action);
    if (t.opening) addPiece(wallFromData({ ...t.data, openings: t.data.openings.filter((o) => o !== t.opening) }), action);
    commit(action);
    flash(shot.hit.point, '#d6d3d1');
    ctx.audio.play({ frequency: 90, pitchDrop: 40, noiseMix: 0.8, durationMs: 320, volume: 0.6 });
    return true;
  },
  tick() {
    if (!ctx.world.isHost()) return;
    const shot = aimThrough();
    if (!shot) return;
    const t = target(shot);
    showBeam(shot.from, shot.end, t ? BAD : '#94a3b8');
    if (t) preview('target', BAD, outline(t));
    previewsDone();
    readout('Sledgehammer', [t ? 'Knock down: ' + NAMES[t.opening ? t.opening.kind : t.data.kind] : 'Point at what you built', 'Menu: Undo']);
  },
  getRadialItems() {
    return [undoItem()];
  }
};
`;

// --- The tools' models, cards and scripts --------------------------------------------------------------------------------

const handle = (color = '#374151') => ({ name: 'Handle', mesh: 'box', position: [0, 0, 0], scale: [0.03, 0.03, 0.16], color, collider: true });
/** @param {number} z */
const muzzle = (z) => ({ name: 'Muzzle', position: [0, 0, z] });
/**
 * A small screen on the back of the tool, facing whoever holds it, that says what the tool will do.
 * @param {string} title
 * @param {number[]} [position]
 */
const readoutPart = (title, position = [0, 0.06, -0.03]) => ({
	name: 'Readout',
	mesh: 'plane',
	position,
	// A plane is seen from its -Z side, and pitching it lifts that side towards the holder.
	rotation: tilt(Math.PI / 6),
	scale: [0.2, 0.1, 1],
	color: '#111827',
	textDisplay: { title, lines: [], color: '#111827' }
});

/** Each home tool: its bay, its parts (in the tool's own space), its own script (after both preludes) and its tip card. */
export const HOME_TOOLS = [
	{
		id: 'wall-tool',
		bay: 'home',
		name: 'Wall Tool',
		parts: [
			handle(),
			{ name: 'Head', mesh: 'box', position: [0, 0, 0.11], scale: [0.08, 0.05, 0.025], color: '#c2714f' },
			{ name: 'Mortar', mesh: 'box', position: [0, 0, 0.11], scale: [0.082, 0.004, 0.027], color: '#e7e5e4' },
			muzzle(0.14),
			readoutPart('Wall Tool')
		],
		body: WALL_TOOL,
		tip: { title: 'Wall Tool', lines: ['Hold trigger and drag', 'along the floor: a wall', 'Menu > Draw: Room makes', 'four walls and a floor'] }
	},
	{
		id: 'floor-tool',
		bay: 'home',
		name: 'Floor Tool',
		parts: [
			handle(),
			{ name: 'Head', mesh: 'box', position: [0, 0, 0.115], scale: [0.075, 0.012, 0.075], color: '#b07d4f' },
			muzzle(0.16),
			readoutPart('Floor Tool')
		],
		body: FLOOR_TOOL,
		tip: { title: 'Floor Tool', lines: ['Hold trigger and drag:', 'a floor, square by square', 'Lay it again to change it', 'Menu: finish, level, undo'] }
	},
	{
		id: 'stairs-tool',
		bay: 'home',
		name: 'Stairs Tool',
		parts: [
			handle(),
			...[0, 1, 2].map((i) => ({ name: 'Step', mesh: 'box', position: [0, -0.015 + 0.0075 * (i + 1), 0.095 + i * 0.022], scale: [0.05, 0.015 * (i + 1), 0.022], color: '#b07d4f' })),
			muzzle(0.14),
			readoutPart('Stairs')
		],
		body: STAIRS_TOOL,
		tip: { title: 'Stairs Tool', lines: ['Point where they start,', 'the way up, and pull', 'They climb one level and', 'open the floor above'] }
	},
	{
		id: 'door-window-tool',
		bay: 'home-details',
		name: 'Door & Window Tool',
		parts: [
			handle(),
			{ name: 'Frame', mesh: 'box', position: [0, 0, 0.11], scale: [0.06, 0.075, 0.01], color: '#f8fafc' },
			{ name: 'Glass', mesh: 'box', position: [0, 0, 0.11], scale: [0.044, 0.058, 0.014], color: '#7dd3fc' },
			muzzle(0.14),
			readoutPart('Doors & Windows')
		],
		body: DOOR_WINDOW_TOOL,
		tip: { title: 'Door & Window Tool', lines: ['Point at a wall and pull', 'Menu: door, windows,', 'archway', 'Doors open as you come'] }
	},
	{
		id: 'roof-tool',
		bay: 'home-details',
		name: 'Roof Tool',
		parts: [
			handle(),
			{ name: 'Roof Side', mesh: 'box', position: [0.018, 0.012, 0.11], rotation: roll(-0.6), scale: [0.045, 0.006, 0.07], color: '#a3402f' },
			{ name: 'Roof Side', mesh: 'box', position: [-0.018, 0.012, 0.11], rotation: roll(0.6), scale: [0.045, 0.006, 0.07], color: '#a3402f' },
			muzzle(0.15),
			readoutPart('Roof Tool')
		],
		body: ROOF_TOOL,
		tip: { title: 'Roof Tool', lines: ['Drag from corner to corner', 'of a room: a roof on its', 'walls. Menu: roof color,', 'which level, undo'] }
	},
	{
		id: 'sledgehammer',
		bay: 'home-details',
		name: 'Sledgehammer',
		lift: 0.01,
		parts: [
			{ name: 'Handle', mesh: 'box', position: [0, 0, 0.03], scale: [0.028, 0.028, 0.26], color: '#8b5a2b', collider: true },
			{ name: 'Head', mesh: 'box', position: [0, 0, 0.17], scale: [0.13, 0.065, 0.065], color: '#4b5563' },
			muzzle(0.21),
			readoutPart('Sledgehammer', [0, 0.06, -0.06])
		],
		body: SLEDGEHAMMER,
		tip: { title: 'Sledgehammer', lines: ['Point at a wall, floor,', 'stairs or roof and pull', 'At a door or window,', 'only that comes out'] }
	}
];

