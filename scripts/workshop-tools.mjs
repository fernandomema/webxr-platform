// The Workshop's tools: what each one is made of, what it does (its codeBlock script) and the tip card hung above it.
// Used by generate-workshop.mjs. A tool points along its own +Z: that is the end that does the work, and the way it
// faces when equipped (the handle sits in the fist, like the lobby's paint brush).

const s45 = Math.SQRT1_2;
/** A cylinder lies along Y; this turns it to lie along the tool (+Z). */
const ALONG = [s45, 0, 0, s45];

/** Held like a wand: the handle in the fist, the working end forward. */
const WAND_GRIP = { position: [0, 0, 0.04], rotation: [15, 0, 0] };

/** Shared by every tool's script: its parts, what it may act on, aiming, the beam, and going back to its bench. */
const PRELUDE = String.raw`
const SELF = ctx.self.id;
const has = (slot, type) => !!slot && slot.components.some((c) => c.type === type);
// Parts are looked up among this tool's own children: several tools use the same part names.
function part(name) { return ctx.hierarchy.getChildren(SELF).find((c) => c.name === name) || null; }
function partPose(name) { const p = part(name); return p ? ctx.hierarchy.getWorldPose(p.id) : null; }
const PALETTE = [
  ['Red', '#ef4444'], ['Orange', '#f97316'], ['Yellow', '#facc15'], ['Lime', '#84cc16'], ['Green', '#22c55e'], ['Teal', '#14b8a6'],
  ['Cyan', '#06b6d4'], ['Blue', '#3b82f6'], ['Purple', '#a855f7'], ['Pink', '#ec4899'], ['White', '#f8fafc'], ['Black', '#111827']
];
// The whole object a slot belongs to: its outermost grabbable ancestor. The building itself belongs to none.
function objectOf(slotId) {
  let found = null;
  for (let slot = ctx.hierarchy.getSlot(slotId), hops = 0; slot && hops < 64; hops++) {
    if (has(slot, 'grabbable')) found = slot;
    slot = slot.parentId ? ctx.hierarchy.getSlot(slot.parentId) : null;
  }
  return found;
}
// Tools and avatars are never changed by another tool; everything else that can be picked up is fair game.
const editable = (object) => !!object && !has(object, 'equippable') && !has(object, 'avatar');
const REACH = 12;
// Where the working end points, and what it hits (null when nothing is within reach).
function aim() {
  const muzzle = partPose('Muzzle');
  if (!muzzle) return null;
  const hit = ctx.world.raycast(muzzle.position, muzzle.forward, REACH);
  return { from: muzzle.position, forward: muzzle.forward, hit, end: hit ? hit.point : ctx.math.vecAdd(muzzle.position, ctx.math.vecScale(muzzle.forward, 2)) };
}
const round3 = (v) => Math.round(v * 1000) / 1000;
// A thin line from the tool to what it points at, while aiming. Guests see it refreshed a few times a second.
let beamId = null;
let beamSynced = 0;
function showBeam(from, to, color) {
  const points = [...from, ...to].map(round3);
  if (!beamId) {
    beamId = crypto.randomUUID();
    ctx.world.spawn({ id: beamId, name: 'Tool Beam', components: [{ type: 'stroke', points, color, width: 0.005 }] });
    beamSynced = Date.now();
    return;
  }
  const now = Date.now();
  const broadcast = now - beamSynced > 120;
  if (broadcast) beamSynced = now;
  ctx.world.setComponentField(beamId, 'stroke', 'points', points, broadcast);
}
function setBeamColor(color) { if (beamId) ctx.world.setComponentField(beamId, 'stroke', 'color', color); }
function hideBeam() { if (beamId) ctx.world.deleteSlot(beamId); beamId = null; }
function flash(point, color) {
  ctx.world.spawn({ name: 'Tool Flash', position: point, components: [{ type: 'particleBurst', color, count: 24, durationMs: 500 }, { type: 'expires', expiresAt: Date.now() + 500 }] });
}
const beep = (frequency) => ctx.audio.play({ frequency, durationMs: 90, volume: 0.35 });
const buzz = () => ctx.audio.play({ frequency: 140, noiseMix: 0.4, durationMs: 160, volume: 0.3 });
// A yaw about world up that turns +Z towards the horizontal part of 'forward'.
function yawTowards(forward) { return ctx.math.quatFromAxisAngle([0, 1, 0], Math.atan2(forward[0], forward[2])); }

// A tool that started on a Workshop bench finds its way back there when it has been left lying somewhere for a while.
// One taken into another world (saved to an inventory) has no bench, and stays wherever it is put down.
const RETURN_AFTER_S = 45;
let home = null;
let idle = 0;
let wasInHand = false;
function returnHome() {
  if (home && ctx.world.setWorldPose(SELF, home)) idle = 0;
}
function withBench(tool) {
  return {
    ...tool,
    onSpawn() {
      const bench = ctx.hierarchy.getParent(SELF);
      if (bench && bench.name.startsWith('Bay: ')) home = { position: ctx.self.getWorldPosition(), rotation: ctx.self.getWorldRotation() };
      if (tool.onSpawn) tool.onSpawn();
    },
    onUnequip(e) {
      hideBeam();
      if (tool.onUnequip) tool.onUnequip(e);
    },
    tick(dt) {
      const inHand = ctx.grab.isHeld() || ctx.equip.isEquipped();
      // Put down mid-use (the trigger's release never comes): whatever it was doing stops.
      if (wasInHand && !inHand) {
        hideBeam();
        if (tool.onDrop) tool.onDrop();
      }
      wasInHand = inHand;
      if (inHand) {
        idle = 0;
        if (tool.tick) tool.tick(dt);
        return;
      }
      if (!ctx.world.isHost() || !home) return;
      const away = ctx.math.vecLength(ctx.math.vecSub(ctx.self.getWorldPosition(), home.position)) > 0.05;
      idle = away ? idle + dt : 0;
      if (idle > RETURN_AFTER_S) returnHome();
    }
  };
}
`;

/** A tool's script: the shared prelude, then the tool's own handlers wrapped so it also returns to its bench. */
const script = (body) => `${PRELUDE}\n${body.trim()}\nreturn withBench(tool);\n`;

// --- Shapes -----------------------------------------------------------------------------------------------------------

const SHAPE_MAKER = String.raw`
// name, mesh, proportions (times the size), collider
const SHAPES = [
  ['Box', 'box', [1, 1, 1], 'box'], ['Sphere', 'sphere', [1, 1, 1], 'sphere'], ['Cylinder', 'cylinder', [1, 1, 1], 'box'],
  ['Plank', 'box', [2, 0.15, 0.5], 'box'], ['Pillar', 'cylinder', [0.4, 2, 0.4], 'box'], ['Tile', 'box', [1, 0.1, 1], 'box']
];
const SIZES = [['Small', 0.1], ['Medium', 0.25], ['Large', 0.5]];
let shape = 0, size = 1, color = 7;

function showColor() { const p = part('Preview'); if (p) ctx.world.setComponentField(p.id, 'meshRenderer', 'color', PALETTE[color][1]); }

const tool = {
  onSpawn() { showColor(); },
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const muzzle = partPose('Muzzle');
    if (!muzzle) return true;
    const [name, mesh, proportions, collider] = SHAPES[shape];
    const scale = proportions.map((p) => round3(p * SIZES[size][1]));
    // Far enough ahead that the new shape does not start inside the tool.
    const ahead = 0.06 + Math.max(...scale) / 2;
    const position = ctx.math.vecAdd(muzzle.position, ctx.math.vecScale(muzzle.forward, ahead)).map(round3);
    ctx.world.spawn({
      name,
      position,
      rotation: yawTowards(muzzle.forward),
      scale,
      components: [
        { type: 'meshRenderer', meshRef: { kind: 'builtin', id: mesh }, color: PALETTE[color][1] },
        { type: 'collider', shape: collider },
        { type: 'grabbable', scalable: true }
      ]
    });
    flash(position, PALETTE[color][1]);
    beep(520 + shape * 60);
    return true;
  },
  getRadialItems() {
    return [
      { label: 'Shape: ' + SHAPES[shape][0], isEnabled: () => true, onSelect: () => { shape = (shape + 1) % SHAPES.length; } },
      { label: 'Size: ' + SIZES[size][0], isEnabled: () => true, onSelect: () => { size = (size + 1) % SIZES.length; } },
      { label: 'Color: ' + PALETTE[color][0], isEnabled: () => true, onSelect: () => { color = (color + 1) % PALETTE.length; showColor(); } }
    ];
  }
};
`;

const COPIER = String.raw`
let aiming = false;
const BEAM = '#22d3ee';

// Every slot of an object, parents before children.
function subtree(rootId) {
  const out = [];
  const queue = [ctx.hierarchy.getSlot(rootId)];
  while (queue.length) {
    const slot = queue.shift();
    if (!slot) continue;
    out.push(slot);
    queue.push(...ctx.hierarchy.getChildren(slot.id));
  }
  return out;
}

function copy(object, towards) {
  const pose = ctx.hierarchy.getWorldPose(object.id);
  if (!pose) return null;
  const ids = new Map();
  const slots = subtree(object.id);
  for (const slot of slots) ids.set(slot.id, crypto.randomUUID());
  // The copy comes out a little towards the tool, so it does not sit inside the original.
  const position = ctx.math.vecAdd(pose.position, ctx.math.vecScale(towards, -0.25)).map(round3);
  for (const slot of slots) {
    const components = JSON.parse(JSON.stringify(slot.components));
    for (const c of components) if (c.type === 'socket') delete c.occupantId;
    const root = slot.id === object.id;
    ctx.world.spawn({
      id: ids.get(slot.id),
      parentId: root ? null : ids.get(slot.parentId),
      name: slot.name,
      position: root ? position : slot.position,
      rotation: root ? pose.rotation : slot.rotation,
      scale: slot.scale,
      components
    });
  }
  return position;
}

const tool = {
  onDrop() { aiming = false; },
  onTrigger(e) {
    if (e.phase === 'press') aiming = true;
    if (e.phase !== 'release' || !aiming) return true;
    aiming = false;
    const shot = aim();
    hideBeam();
    const object = shot && shot.hit ? objectOf(shot.hit.slotId) : null;
    if (!editable(object)) { buzz(); return true; }
    const at = copy(object, shot.forward);
    if (at) { flash(at, BEAM); beep(660); }
    return true;
  },
  tick() {
    if (!aiming || !ctx.world.isHost()) return;
    const shot = aim();
    if (shot) showBeam(shot.from, shot.end, BEAM);
  }
};
`;

const ERASER = String.raw`
const MODES = ['Objects', 'Drawings'];
let mode = 0;
let pressed = false;
let rubbed = 0;
const BEAM = '#f43f5e';
const TOUCH = 0.05;

// Strokes are drawn lines: erased by touching them with the tip, not by aiming (a line is too thin to point at).
function eraseTouchedStrokes() {
  const tip = partPose('Tip');
  if (!tip) return;
  const [x, y, z] = tip.position;
  for (const slot of ctx.hierarchy.getChildren(null)) {
    const stroke = slot.components.find((c) => c.type === 'stroke');
    if (!stroke || slot.name === 'Tool Beam') continue;
    const reach = TOUCH + (stroke.width || 0) / 2;
    const p = stroke.points;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const dx = p[i] - x, dy = p[i + 1] - y, dz = p[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) {
        ctx.world.deleteSlot(slot.id);
        flash(tip.position, BEAM);
        break;
      }
    }
  }
}

const tool = {
  onDrop() { pressed = false; },
  onTrigger(e) {
    if (e.phase === 'press') { pressed = true; return true; }
    if (e.phase !== 'release' || !pressed) return true;
    pressed = false;
    if (MODES[mode] !== 'Objects') return true;
    const shot = aim();
    hideBeam();
    const object = shot && shot.hit ? objectOf(shot.hit.slotId) : null;
    if (!editable(object)) { buzz(); return true; }
    ctx.world.deleteSlot(object.id);
    flash(shot.hit.point, BEAM);
    beep(300);
    return true;
  },
  tick(dt) {
    if (!pressed || !ctx.world.isHost()) return;
    if (MODES[mode] === 'Objects') {
      const shot = aim();
      if (shot) showBeam(shot.from, shot.end, BEAM);
      return;
    }
    rubbed += dt;
    if (rubbed < 0.1) return;
    rubbed = 0;
    eraseTouchedStrokes();
  },
  getRadialItems() {
    return [{ label: 'Erase: ' + MODES[mode], isEnabled: () => true, onSelect: () => { mode = (mode + 1) % MODES.length; hideBeam(); } }];
  }
};
`;

// --- Paint & Color ------------------------------------------------------------------------------------------------------

const PAINT_BRUSH = String.raw`
const SIZES = [['Fine', 0.008], ['Medium', 0.018], ['Thick', 0.035]];
const MIN_STEP = 0.012;          // meters between recorded points
const SYNC_MS = 150;             // how often guests get the growing stroke
const MAX_STROKE_POINTS = 1200;  // a longer line continues in a new stroke
const MAX_TOTAL_POINTS = 8000;   // oldest strokes are erased past this
let color = 0;
let size = 1;
let drawing = false;
let strokeId = null;
let points = [];
let lastSync = 0;
const strokes = [];              // { id, count } oldest first

function tipPosition() { const pose = partPose('Brush Tip'); return pose ? pose.position : null; }
function paintTip() { const tip = part('Brush Tip'); if (tip) ctx.world.setComponentField(tip.id, 'meshRenderer', 'color', PALETTE[color][1]); }
const totalPoints = () => strokes.reduce((sum, s) => sum + s.count, 0);

function beginStroke(p) {
  strokeId = crypto.randomUUID();
  points = p.map(round3);
  strokes.push({ id: strokeId, count: 1 });
  ctx.world.spawn({ id: strokeId, name: 'Brush Stroke', components: [{ type: 'stroke', points: points.slice(), color: PALETTE[color][1], width: SIZES[size][1] }] });
  lastSync = Date.now();
  while (totalPoints() > MAX_TOTAL_POINTS && strokes.length > 1) ctx.world.deleteSlot(strokes.shift().id);
}

// Updates this peer every time; guests only every SYNC_MS (or when forced).
function pushPoints(force) {
  if (!strokeId) return;
  const now = Date.now();
  const broadcast = force || now - lastSync >= SYNC_MS;
  if (broadcast) lastSync = now;
  ctx.world.setComponentField(strokeId, 'stroke', 'points', points.slice(), broadcast);
  strokes[strokes.length - 1].count = points.length / 3;
}

function endStroke() {
  if (strokeId) pushPoints(true);
  drawing = false;
  strokeId = null;
  points = [];
}

const tool = {
  onSpawn() { paintTip(); },
  onEquip() { paintTip(); },
  onUnequip() { endStroke(); },
  onDrop() { endStroke(); },
  onTrigger(e) {
    if (e.phase === 'press') {
      const p = tipPosition();
      if (!p) return true;
      drawing = true;
      beginStroke(p);
    } else if (e.phase === 'release') {
      endStroke();
    }
    return true;
  },
  tick() {
    if (!drawing || !ctx.world.isHost()) return;
    if (!ctx.equip.isEquipped() && !ctx.grab.isHeld()) { endStroke(); return; }
    const p = tipPosition();
    if (!p || !strokeId) return;
    const n = points.length;
    const from = [points[n - 3], points[n - 2], points[n - 1]];
    if (ctx.math.vecLength(ctx.math.vecSub(p, from)) < MIN_STEP) { pushPoints(false); return; }
    points.push(...p.map(round3));
    if (points.length / 3 >= MAX_STROKE_POINTS) { pushPoints(true); beginStroke(p); return; }
    pushPoints(false);
  },
  getRadialItems() {
    return [
      { label: 'Color: ' + PALETTE[color][0], isEnabled: () => true, onSelect: () => { color = (color + 1) % PALETTE.length; paintTip(); } },
      { label: 'Size: ' + SIZES[size][0], isEnabled: () => true, onSelect: () => { size = (size + 1) % SIZES.length; } },
      { label: 'Clear my strokes', isEnabled: () => strokes.length > 0, onSelect: () => { while (strokes.length) ctx.world.deleteSlot(strokes.pop().id); strokeId = null; points = []; } }
    ];
  }
};
`;

const COLOR_SPRAYER = String.raw`
const MODES = ['Paint', 'Pick color'];
let mode = 0;
let color = PALETTE[0][1];
let paletteIndex = 0;
let aiming = false;

function showColor() { const tank = part('Tank'); if (tank) ctx.world.setComponentField(tank.id, 'meshRenderer', 'color', color); setBeamColor(color); }
const colorName = () => (PALETTE.find((entry) => entry[1] === color) || ['Custom'])[0];

const tool = {
  onSpawn() { showColor(); },
  onDrop() { aiming = false; },
  onTrigger(e) {
    if (e.phase === 'press') aiming = true;
    if (e.phase !== 'release' || !aiming) return true;
    aiming = false;
    const shot = aim();
    hideBeam();
    const hit = shot && shot.hit;
    const target = hit ? ctx.hierarchy.getSlot(hit.slotId) : null;
    const renderer = target && target.components.find((c) => c.type === 'meshRenderer');
    // Only the parts of loose objects: the building and the tools keep their colours.
    if (!renderer || !editable(objectOf(target.id))) { buzz(); return true; }
    if (MODES[mode] === 'Paint') {
      ctx.world.setComponentField(target.id, 'meshRenderer', 'color', color);
      flash(hit.point, color);
      beep(700);
    } else if (renderer.color) {
      color = renderer.color;
      showColor();
      beep(880);
    }
    return true;
  },
  tick() {
    if (!aiming || !ctx.world.isHost()) return;
    const shot = aim();
    if (shot) showBeam(shot.from, shot.end, MODES[mode] === 'Paint' ? color : '#f8fafc');
  },
  getRadialItems() {
    return [
      { label: 'Color: ' + colorName(), isEnabled: () => true, onSelect: () => { paletteIndex = (paletteIndex + 1) % PALETTE.length; color = PALETTE[paletteIndex][1]; showColor(); } },
      { label: 'Mode: ' + MODES[mode], isEnabled: () => true, onSelect: () => { mode = (mode + 1) % MODES.length; } }
    ];
  }
};
`;

// --- Measure & Align ----------------------------------------------------------------------------------------------------

const TAPE_MEASURE = String.raw`
const UNITS = [['m', 1, 2], ['cm', 100, 1]];
let unit = 0;
let start = null;
let lineId = null;
let lineSynced = 0;
let shown = 0;
const measurements = [];         // ids of every line and label left behind
const LINE = '#facc15';

// A measurement left half-way (the tool was put down) is removed.
function cancel() { if (lineId && start) ctx.world.deleteSlot(lineId); lineId = null; start = null; }
function format(meters) { const [name, factor, digits] = UNITS[unit]; return (meters * factor).toFixed(digits) + ' ' + name; }
function readout(text) { const r = part('Readout'); if (r) ctx.world.setComponentField(r.id, 'textDisplay', 'title', text, false); }

function drawLine(a, b, broadcast) {
  const points = [...a, ...b].map(round3);
  if (!lineId) {
    lineId = crypto.randomUUID();
    ctx.world.spawn({ id: lineId, name: 'Measure Line', components: [{ type: 'stroke', points, color: LINE, width: 0.006 }] });
    return;
  }
  ctx.world.setComponentField(lineId, 'stroke', 'points', points, broadcast);
}

// A label at the middle of the line, turned to face whoever measured.
function label(a, b, viewer) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.07, (a[2] + b[2]) / 2].map(round3);
  const dx = viewer[0] - mid[0], dz = viewer[2] - mid[2];
  const yaw = Math.atan2(-dx, -dz);
  const id = crypto.randomUUID();
  ctx.world.spawn({
    id,
    name: 'Measure Label',
    position: mid,
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    scale: [0.3, 0.15, 1],
    components: [
      { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#111827' },
      { type: 'textDisplay', title: format(ctx.math.vecLength(ctx.math.vecSub(b, a))), lines: [], color: '#111827' }
    ]
  });
  return id;
}

const tool = {
  onSpawn() { readout('Tape Measure'); },
  onUnequip() { cancel(); },
  onDrop() { cancel(); },
  onTrigger(e) {
    const shot = aim();
    if (!shot) return true;
    if (e.phase === 'press') {
      start = shot.end;
      lineId = null;
      drawLine(start, start, true);
      beep(600);
      return true;
    }
    if (e.phase !== 'release' || !start) return true;
    const end = shot.end;
    const length = ctx.math.vecLength(ctx.math.vecSub(end, start));
    if (length < 0.01) {
      if (lineId) ctx.world.deleteSlot(lineId);
    } else {
      drawLine(start, end, true);
      measurements.push(lineId, label(start, end, shot.from));
      readout(format(length));
      beep(800);
    }
    lineId = null;
    start = null;
    return true;
  },
  tick() {
    if (!start || !ctx.world.isHost()) return;
    const shot = aim();
    if (!shot) return;
    const now = Date.now();
    const broadcast = now - lineSynced > 120;
    if (broadcast) lineSynced = now;
    drawLine(start, shot.end, broadcast);
    if (now - shown > 100) { shown = now; readout(format(ctx.math.vecLength(ctx.math.vecSub(shot.end, start)))); }
  },
  getRadialItems() {
    return [
      { label: 'Units: ' + UNITS[unit][0], isEnabled: () => true, onSelect: () => { unit = (unit + 1) % UNITS.length; } },
      { label: 'Clear measurements', isEnabled: () => measurements.length > 0, onSelect: () => { while (measurements.length) ctx.world.deleteSlot(measurements.pop()); readout('Tape Measure'); } }
    ];
  }
};
`;

const ALIGNER = String.raw`
const ANGLES = [['90°', 90], ['45°', 45], ['15°', 15]];
const GRIDS = [['Off', 0], ['5 cm', 0.05], ['10 cm', 0.1], ['25 cm', 0.25]];
let angle = 0, grid = 0;
let aiming = false;
const BEAM = '#4ade80';
const m = ctx.math;

// The object's own axes, in both directions: the one pointing most nearly up is made to point straight up.
function mostUpright(pose) {
  let best = null, bestDot = -2;
  for (const axis of [pose.up, pose.forward, pose.right]) {
    for (const sign of [1, -1]) {
      const v = m.vecScale(axis, sign);
      if (v[1] > bestDot) { bestDot = v[1]; best = v; }
    }
  }
  return best;
}

// Stands the object on its most upright axis, then turns it about the vertical to the nearest step of the chosen angle.
function straightened(pose) {
  const upright = mostUpright(pose);
  let rotation = pose.rotation;
  const axis = m.vecCross(upright, [0, 1, 0]);
  const sin = m.vecLength(axis);
  if (sin > 1e-6) rotation = m.quatMultiply(m.quatFromAxisAngle(axis, Math.atan2(sin, upright[1])), rotation);
  else if (upright[1] < 0) rotation = m.quatMultiply(m.quatFromAxisAngle([1, 0, 0], Math.PI), rotation);
  // A horizontal axis of the upright object, to read its turn about the vertical from.
  let across = m.rotateVec(rotation, [0, 0, 1]);
  if (Math.abs(across[1]) > 0.9) across = m.rotateVec(rotation, [1, 0, 0]);
  const yaw = Math.atan2(across[0], across[2]);
  const step = ANGLES[angle][1] * Math.PI / 180;
  const snapped = Math.round(yaw / step) * step;
  return m.quatMultiply(m.quatFromAxisAngle([0, 1, 0], snapped - yaw), rotation);
}

const tool = {
  onDrop() { aiming = false; },
  onTrigger(e) {
    if (e.phase === 'press') aiming = true;
    if (e.phase !== 'release' || !aiming) return true;
    aiming = false;
    const shot = aim();
    hideBeam();
    const object = shot && shot.hit ? objectOf(shot.hit.slotId) : null;
    const pose = editable(object) ? ctx.hierarchy.getWorldPose(object.id) : null;
    if (!pose) { buzz(); return true; }
    const size = GRIDS[grid][1];
    const position = size ? pose.position.map((v) => round3(Math.round(v / size) * size)) : undefined;
    if (!ctx.world.setWorldPose(object.id, { rotation: straightened(pose), position })) { buzz(); return true; }
    flash(pose.position, BEAM);
    beep(760);
    return true;
  },
  tick() {
    if (!aiming || !ctx.world.isHost()) return;
    const shot = aim();
    if (shot) showBeam(shot.from, shot.end, BEAM);
  },
  getRadialItems() {
    return [
      { label: 'Turn to: ' + ANGLES[angle][0], isEnabled: () => true, onSelect: () => { angle = (angle + 1) % ANGLES.length; } },
      { label: 'Grid: ' + GRIDS[grid][0], isEnabled: () => true, onSelect: () => { grid = (grid + 1) % GRIDS.length; } }
    ];
  }
};
`;

// --- The tools, by bay --------------------------------------------------------------------------------------------------

const handle = (color = '#374151') => ({ name: 'Handle', mesh: 'box', position: [0, 0, 0], scale: [0.03, 0.03, 0.16], color, collider: true });
const muzzle = (z) => ({ name: 'Muzzle', position: [0, 0, z] });

/**
 * Each tool: the bay it belongs to, its parts (in the tool's own space), its script, and the tip card above it.
 * A part without a mesh is just a point the script reads (the Muzzle it aims from).
 */
export const TOOLS = [
	{
		id: 'shape-maker',
		bay: 'shapes',
		name: 'Shape Maker',
		parts: [
			handle(),
			{ name: 'Barrel', mesh: 'cylinder', position: [0, 0, 0.12], rotation: ALONG, scale: [0.045, 0.09, 0.045], color: '#8b5cf6' },
			{ name: 'Preview', mesh: 'box', position: [0, 0.035, 0.03], scale: [0.04, 0.04, 0.04], color: '#3b82f6' },
			muzzle(0.17)
		],
		code: script(SHAPE_MAKER),
		tip: { title: 'Shape Maker', lines: ['Trigger: make a shape', 'Menu: shape, size, color', 'Grab shapes with both hands', 'to scale them'] }
	},
	{
		id: 'copier',
		bay: 'shapes',
		name: 'Copier',
		parts: [handle(), { name: 'Head', mesh: 'box', position: [0, 0, 0.11], scale: [0.06, 0.04, 0.06], color: '#22d3ee' }, muzzle(0.15)],
		code: script(COPIER),
		tip: { title: 'Copier', lines: ['Hold trigger: aim', 'Release: copy the object', 'The copy appears in front', 'of the original'] }
	},
	{
		id: 'eraser',
		bay: 'shapes',
		name: 'Eraser',
		parts: [handle(), { name: 'Tip', mesh: 'box', position: [0, 0, 0.11], scale: [0.05, 0.035, 0.06], color: '#f472b6' }, muzzle(0.15)],
		code: script(ERASER),
		tip: { title: 'Eraser', lines: ['Objects: aim, release', 'to delete', 'Drawings: hold trigger and', 'rub the tip over a line'] }
	},
	{
		id: 'paint-brush',
		bay: 'paint',
		name: 'Paint Brush',
		parts: [
			{ name: 'Handle', mesh: 'box', position: [0, 0, 0], scale: [0.022, 0.022, 0.2], color: '#8b5a2b', collider: true },
			{ name: 'Brush Tip', mesh: 'sphere', position: [0, 0, 0.11], scale: [0.04, 0.04, 0.04], color: '#ef4444' }
		],
		code: script(PAINT_BRUSH),
		tip: { title: 'Paint Brush', lines: ['Hold trigger: draw in the air', 'Menu: color, size', 'Erase lines with the Eraser'] }
	},
	{
		id: 'color-sprayer',
		bay: 'paint',
		name: 'Color Sprayer',
		parts: [
			handle(),
			{ name: 'Tank', mesh: 'cylinder', position: [0, 0.045, -0.01], scale: [0.05, 0.07, 0.05], color: '#ef4444' },
			{ name: 'Nozzle', mesh: 'box', position: [0, 0, 0.1], scale: [0.025, 0.025, 0.05], color: '#9ca3af' },
			muzzle(0.13)
		],
		code: script(COLOR_SPRAYER),
		tip: { title: 'Color Sprayer', lines: ['Hold trigger: aim', 'Release: paint that part', 'Menu: color, or Pick color', 'to copy a color you aim at'] }
	},
	{
		id: 'tape-measure',
		bay: 'measure',
		name: 'Tape Measure',
		parts: [
			handle('#1f2937'),
			{ name: 'Case', mesh: 'box', position: [0, 0, 0.1], scale: [0.06, 0.06, 0.05], color: '#facc15' },
			{
				name: 'Readout',
				mesh: 'plane',
				position: [0, 0.06, -0.03],
				// Faces back and up at whoever holds it: a plane is seen from its -Z side, and pitching it lifts that side.
				rotation: [Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)],
				scale: [0.2, 0.1, 1],
				color: '#111827',
				textDisplay: { title: 'Tape Measure', lines: [], color: '#111827' }
			},
			muzzle(0.13)
		],
		code: script(TAPE_MEASURE),
		tip: { title: 'Tape Measure', lines: ['Press at one point,', 'release at another', 'The distance stays on a label', 'Menu: units, clear'] }
	},
	{
		id: 'aligner',
		bay: 'measure',
		name: 'Aligner',
		parts: [
			handle(),
			{ name: 'Head', mesh: 'box', position: [0, 0, 0.11], scale: [0.07, 0.03, 0.06], color: '#4ade80' },
			{ name: 'Bubble', mesh: 'sphere', position: [0, 0.02, 0.11], scale: [0.02, 0.02, 0.02], color: '#f8fafc' },
			muzzle(0.15)
		],
		code: script(ALIGNER),
		tip: { title: 'Aligner', lines: ['Aim at an object, release:', 'it stands upright and square', 'Menu: angle step,', 'snap to a grid'] }
	}
];

/** How every tool is held: in the fist like a wand, the fingers closing round its handle. */
export const toolEquippable = () => ({ type: 'equippable', left: WAND_GRIP, right: WAND_GRIP, autoGrip: true });

/** The general tip at the entrance: how any tool is picked up and used. */
export const TOOL_BASICS = { title: 'Using tools', lines: ['Grip: pick a tool up', 'B, Y or stick click: its menu', 'Menu > Equip: keep it in hand', 'Trigger: use it'] };
