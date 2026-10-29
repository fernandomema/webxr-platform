import { DOOR, HALLOWEEN } from './halloweenGatheringConfig.ts';

const houses = HALLOWEEN.houses.map((house) => ({ id: house.id, name: house.name, seed: house.seed, mystery: house.mystery, color: house.color, o: house.frame.o, r: house.frame.r, d: house.frame.d }));

/**
 * The director of the Lantern Night, run by the host. For each house: it listens for knocking (a hand that strikes the door, or on a
 * desktop someone who waits at it), opens the door a little, slides out a hand that holds a gift, and then keeps the palm open for
 * another. What it is given is kept in the world's storage (`ctx.storage.world`) for whoever knocks next; if there is no storage
 * (a published world played without an account) it is kept for the rest of the session. Nothing here is a button.
 */
export const HALLOWEEN_SCRIPT = `
const HOUSES = ${JSON.stringify(houses)};
const SEEDS = ${JSON.stringify(HALLOWEEN.seeds)};
const DOOR = ${JSON.stringify(DOOR)};
const GOAL = ${HALLOWEEN.goal};
const CENTER = ${JSON.stringify(HALLOWEEN.center)};
const ROOT = '${HALLOWEEN.director}';
const KINDS = Object.keys(SEEDS);
const MAX_ITEMS = 5, MAX_BYTES = 12000, MAX_NODES = 40, MAX_STORED = 14000;
const KEEP = ['container', 'meshRenderer', 'collider', 'grabbable', 'equippable', 'insertable', 'pointLight', 'spotLight', 'textDisplay', 'stroke', 'particleEmitter'];

let state = null, initialized = false, clock = 0, flushIn = 0, dirty = false, counter = 0, seedHashes = null, board = { total: 0, recent: [] };
const memory = {}, timers = [], cache = {};
const doors = HOUSES.map(() => ({ phase: 'closed', t: 0, open: 0, reach: 0, curl: 0.25, droop: 0, shake: 0, want: 0, knocks: {}, last: {}, swing: {}, linger: {}, entry: null, loading: false, giftId: null, taker: null, visitor: null, cooldown: 0, refused: {}, scan: 0, sad: false, expectT: 0, wantOn: false }));

const q = (axis, a) => { const s = Math.sin(a / 2), c = Math.cos(a / 2); return axis === 0 ? [s, 0, 0, c] : axis === 1 ? [0, s, 0, c] : [0, 0, s, c]; };
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const ease = (value, target, dt, rate) => value + (target - value) * Math.min(1, dt * rate);
const round = (list) => list.map((v) => Math.round(v * 1e4) / 1e4);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function toWorld(i, l) { const h = HOUSES[i]; return [h.o[0] + h.r[0] * l[0] + h.d[0] * l[2], h.o[1] + l[1], h.o[2] + h.r[2] * l[0] + h.d[2] * l[2]]; }
function toLocal(i, p) { const h = HOUSES[i], x = p[0] - h.o[0], z = p[2] - h.o[2]; return [x * h.r[0] + z * h.r[2], p[1] - h.o[1], x * h.d[0] + z * h.d[2]]; }
function toLocalDir(i, v) { const h = HOUSES[i]; return [v[0] * h.r[0] + v[2] * h.r[2], v[1], v[0] * h.d[0] + v[2] * h.d[2]]; }
function palm(i, lift) { return toWorld(i, [DOOR.handX, DOOR.handY + (lift || 0), DOOR.rest - DOOR.reach * doors[i].reach]); }

function component(id, type) { const slot = ctx.hierarchy.getSlot(id); return slot && slot.components.find((c) => c.type === type); }
function set(id, type, field, value, broadcast = true) {
  const current = component(id, type);
  if (current && JSON.stringify(current[field]) !== JSON.stringify(value)) ctx.world.setComponentField(id, type, field, value, broadcast);
}
function enabled(id, value) { ctx.world.setSlotEnabled(id, value, true); }
function publish() { set(ROOT, 'scriptState', 'data', JSON.parse(JSON.stringify(state))); }
/** Moves a part of a house inside it. Quiet and skipped when nothing changed: the guests follow with the next state update. */
function pose(id, position, rotation, scale) {
  const key = JSON.stringify([position && round(position), rotation && round(rotation), scale && round(scale)]);
  if (cache[id] === key) return;
  cache[id] = key; dirty = true;
  const value = {};
  if (position) value.position = position;
  if (rotation) value.rotation = rotation;
  if (scale) value.scale = scale;
  ctx.world.setLocalPose(id, value, false);
}
function later(seconds, fn) { timers.push({ at: clock + seconds, fn }); }
function sound(position, frequency, color, count, volume) {
  ctx.world.spawn({ name: 'Halloween Spark', position, components: [
    { type: 'impactSound', frequency, pitchDrop: 30, noiseMix: 0.06, durationMs: 650, volume: volume || 0.38 },
    { type: 'particleBurst', color, count: count || 18, durationMs: 900 },
    { type: 'expires', expiresAt: Date.now() + 1500 }
  ] }, { ephemeral: true });
}
function thud(position) {
  ctx.world.spawn({ name: 'Knock', position, components: [
    { type: 'impactSound', frequency: 140, pitchDrop: 70, noiseMix: 0.6, durationMs: 200, volume: 0.8 },
    { type: 'expires', expiresAt: Date.now() + 600 }
  ] }, { ephemeral: true });
}
function chime(position, color, notes) { notes.forEach((frequency, k) => later(k * 0.13, () => sound(position, frequency, color, 10, 0.3))); }

function nearestPlayer(position) {
  let best = null, distance = Infinity;
  for (const player of ctx.world.getPlayers()) {
    const view = ctx.world.getPlayerPose(player.id);
    if (!view) continue;
    for (const point of [view.head.position, view.left && view.left.position, view.right && view.right.position]) {
      if (!point) continue;
      const d = dist(point, position);
      if (d < distance) { distance = d; best = player; }
    }
  }
  return best;
}
/** The whole object a part belongs to: the outermost grabbable above it, so the crank of a music box is the music box, not a gift of its own. */
function grabbableRoot(slot) {
  let s = slot, found = null;
  for (let guard = 0; s && guard < 8; guard++) {
    if (s.components.some((c) => c.type === 'grabbable')) found = s;
    s = s.parentId ? ctx.hierarchy.getSlot(s.parentId) : null;
  }
  return found;
}

// --- what the houses keep ---

async function load(i) {
  if (!ctx.storage || !ctx.storage.available) return { items: memory[i] || [], version: undefined };
  const entry = await ctx.storage.world.getEntry('gifts-' + i);
  const items = entry && entry.value && Array.isArray(entry.value.items) ? entry.value.items : [];
  return { items, version: entry ? entry.version : undefined };
}
async function save(i, items, version) {
  if (!ctx.storage || !ctx.storage.available) { memory[i] = items; return true; }
  try {
    await ctx.storage.world.set('gifts-' + i, { items }, version === undefined ? undefined : { expectedVersion: version });
    return true;
  } catch (error) { return false; }
}
function fit(items) {
  while (items.length > MAX_ITEMS || (items.length > 1 && JSON.stringify(items).length > MAX_STORED)) items.shift();
  return items;
}
async function addItem(i, item) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { items, version } = await load(i);
    items.push(item);
    if (await save(i, fit(items), version)) return true;
  }
  return false;
}
function seedEntry(i) {
  const kind = HOUSES[i].mystery ? KINDS[Math.floor(Math.random() * KINDS.length)] : HOUSES[i].seed;
  return { seed: kind, name: SEEDS[kind].name, by: '', byId: null };
}
/** The mystery door gives something from anywhere: a random gift out of everything the visitors have left at any door. */
async function prepareMystery(i, visitorId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const stores = [];
    for (let k = 0; k < HOUSES.length; k++) stores.push(await load(k));
    const pool = [];
    stores.forEach((store, k) => store.items.forEach((item) => { if (item.byId !== visitorId) pool.push([k, item]); }));
    if (!pool.length) return seedEntry(i);
    const [k, pick] = pool[Math.floor(Math.random() * pool.length)];
    if (await save(k, stores[k].items.filter((item) => item !== pick), stores[k].version)) return pick;
  }
  return seedEntry(i);
}
/** What the house will hold out for this visitor: something somebody else left, or else the house's own gift. It is taken out of the store. */
async function prepareGift(i, visitorId) {
  if (HOUSES[i].mystery) return prepareMystery(i, visitorId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { items, version } = await load(i);
    const options = items.filter((item) => item.byId !== visitorId);
    if (!options.length) return seedEntry(i);
    const pick = options[Math.floor(Math.random() * options.length)];
    if (await save(i, items.filter((item) => item !== pick), version)) return pick;
  }
  return seedEntry(i);
}

function pack(root) {
  const out = [];
  function walk(slot, parent) {
    if (out.length >= MAX_NODES) throw new Error('too big');
    const index = out.length;
    out.push({ p: parent, n: slot.name, pos: slot.position, rot: slot.rotation, sc: slot.scale, c: slot.components.filter((c) => KEEP.includes(c.type)).map((c) => JSON.parse(JSON.stringify(c))) });
    for (const child of ctx.hierarchy.getChildren(slot.id)) walk(child, index);
  }
  try { walk(root, -1); } catch (error) { return null; }
  out[0].pos = [0, 0, 0]; out[0].rot = [0, 0, 0, 1];
  if (!out[0].c.some((c) => c.type === 'grabbable')) out[0].c.push({ type: 'grabbable', scalable: false });
  return JSON.stringify(out).length <= MAX_BYTES ? out : null;
}
function build(tree, rootId, position) {
  tree.forEach((node, index) => {
    ctx.world.spawn({ id: index ? rootId + '-' + index : rootId, parentId: node.p < 0 ? null : node.p ? rootId + '-' + node.p : rootId, name: node.n, position: index ? node.pos : position, rotation: node.rot, scale: node.sc, components: node.c });
  });
}
function cloneSeed(kind, rootId, position) {
  const source = SEEDS[kind].id;
  function walk(id, parentId) {
    const original = ctx.hierarchy.getSlot(id);
    if (!original) return;
    const copy = JSON.parse(JSON.stringify(original));
    copy.id = rootId + id.slice(source.length); copy.parentId = parentId;
    copy.components = copy.components.map((c) => c.type === 'scriptState' ? { ...c, data: {} } : c);
    if (id === source) { delete copy.disabled; copy.position = position; copy.rotation = [0, 0, 0, 1]; copy.scale = [1, 1, 1]; }
    ctx.world.spawn(copy);
    for (const child of ctx.hierarchy.getChildren(id)) walk(child.id, copy.id);
  }
  walk(source, null);
}
function spawnGift(i, entry) {
  // A gift kept before its kind was replaced (the old lantern) is given as the house's own gift instead.
  if (entry.seed && !SEEDS[entry.seed]) entry = seedEntry(i);
  const id = 'hg-g-' + (counter++) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  const at = palm(i, 0.09);
  if (entry.seed) cloneSeed(entry.seed, id, at); else build(entry.tree, id, at);
  return id;
}
async function seedHash(kind) {
  if (!seedHashes) seedHashes = {};
  if (seedHashes[kind] === undefined) seedHashes[kind] = await ctx.hierarchy.getSlotHash(SEEDS[kind].id);
  return seedHashes[kind];
}

// --- the board and the Great Pumpkin ---

function drawBoard() {
  const lines = ['Knock twice on a door.', 'Take what the hand offers,', 'then put something in it.', ''];
  if (board.recent.length) {
    lines.push('Left here lately:');
    for (const entry of board.recent) lines.push(entry.by + ' · ' + entry.what);
    if (board.total > board.recent.length) lines.push(board.total + ' gifts shared in all');
  } else lines.push('Nobody has left anything yet.');
  set('hg-board', 'textDisplay', 'lines', lines);
}
function draw() {
  const n = Math.min(state.shared, GOAL), celebration = state.phase === 'celebration';
  for (let i = 0; i < GOAL; i++) enabled('hg-awakening-' + i, i < n);
  enabled('hg-pumpkin-face', n >= 3);
  enabled('hg-celebration', celebration);
  for (let i = 0; i < 3; i++) enabled('hg-ghost-' + i, celebration);
  set('hg-big-pumpkin', 'meshRenderer', 'color', celebration ? '#fb923c' : n >= 3 ? '#c2410c' : '#7c2d12');
  set('hg-big-light', 'pointLight', 'intensity', 0.8 + n * 0.3);
  set('hg-sky', 'skybox', 'horizonColor', celebration ? '#7c3aed' : n >= 3 ? '#3b0764' : '#1e1b4b');
  set('hg-sky', 'skybox', 'stars', celebration ? 1 : 0.55 + n * 0.06);
  set('hg-celebration-dust', 'particleEmitter', 'active', celebration);
  set('hg-pumpkin-sign', 'textDisplay', 'lines', [celebration ? 'Awake! This night is yours.' : (n >= 3 ? 'Half awake' : 'Sleeping') + ' · ' + n + ' / ' + GOAL]);
}
function keepsakeId(playerId) {
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i++) hash = Math.imul(hash ^ playerId.charCodeAt(i), 16777619);
  return 'hg-keepsake-' + (hash >>> 0).toString(16);
}
function ensureKeepsake(player) {
  const id = keepsakeId(player.id);
  if (ctx.hierarchy.getSlot(id)) return;
  const index = Object.keys(state.players).indexOf(player.id);
  const at = [CENTER[0] - 1.2 + (Math.max(0, index) % 4) * 0.8, 0.4, CENTER[2] - 1.6 - Math.floor(Math.max(0, index) / 4) * 0.5];
  ctx.world.spawn({ id, name: player.name + "'s Little Pumpkin", position: at, components: [{ type: 'container' }, { type: 'grabbable', scalable: false, autoGrip: true }] });
  ctx.world.spawn({ id: id + '-body', parentId: id, name: 'Keepsake Pumpkin', scale: [0.26, 0.22, 0.24], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#fb923c', unlit: true }, { type: 'collider', shape: 'sphere' }] });
  ctx.world.spawn({ id: id + '-stem', parentId: id, name: 'Keepsake Stem', position: [0, 0.14, 0], scale: [0.045, 0.09, 0.045], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#4d7c0f' }] });
}
function shared(person, item, i) {
  state.shared += 1;
  state.players[person.id] = person.name;
  board.recent = [{ by: person.name, what: item.name, house: HOUSES[i].name }].concat(board.recent).slice(0, 5);
  board.total += 1;
  if (ctx.storage && ctx.storage.available) ctx.storage.world.set('board', board).catch(() => {});
  if (state.shared >= GOAL && state.phase !== 'celebration') {
    state.phase = 'celebration';
    sound(CENTER, 880, '#ffcf7a', 70, 0.5);
    for (const [id, name] of Object.entries(state.players)) ensureKeepsake({ id, name });
  }
  drawBoard(); draw(); publish();
}

// --- one house ---

function knocked(i, person, hand) {
  const d = doors[i], key = person.id + (hand || 'head');
  // Each hand counts its own knocks: a knock with one hand and a knock with the other are not a double knock.
  d.knocks[key] = (d.knocks[key] || []).filter((t) => clock - t < 2.2).concat(clock);
  d.shake = 1;
  thud(toWorld(i, [0.1, 1.2, -1.25]));
  if (hand) { try { ctx.haptics.pulse(person.id, { hand, intensity: 0.7, durationMs: 70 }); } catch (error) {} }
  if (d.knocks[key].length >= 2) openDoor(i, person);
}
function openDoor(i, person) {
  const d = doors[i];
  d.phase = 'opening'; d.t = 0; d.knocks = {}; d.visitor = person; d.loading = true; d.entry = null; d.sad = false;
  sound(toWorld(i, [0, 1.2, -1.4]), 160, HOUSES[i].color, 6, 0.3);
  prepareGift(i, person.id).then((entry) => { d.entry = entry; d.loading = false; }).catch(() => { d.entry = seedEntry(i); d.loading = false; });
}
/** The door's face in the house's coordinates (z = -1.2 less half its thickness). */
const FACE = -1.23;
/**
 * Where a hand that stops counts as touching the door. The tracked point is the wrist or the grip, some centimetres behind the
 * knuckles, so a hand whose knuckles meet the door stops a little in front of it; and nothing stops a hand in VR, so one that
 * goes in a little before it stops is touching it too.
 */
const NEAR = FACE - 0.12, DEEP = FACE + 0.25;
/** How fast (m/s, towards the door) a hand must have been going just before it stops for the stop to be a knock. */
const KNOCK_SPEED = 0.45;
/** A hand striking the door, or (for a desktop player, who has no hands) someone who stands at it and waits. */
function listen(i, views, dt) {
  const d = doors[i];
  if (d.phase !== 'closed' || d.cooldown > 0) return;
  for (const [player, view] of views) {
    if (view.left || view.right) {
      for (const hand of ['left', 'right']) {
        if (!view[hand]) continue;
        const key = player.id + hand, l = toLocal(i, view[hand].position), before = d.last[key];
        d.last[key] = l;
        const swing = d.swing[key] || (d.swing[key] = { peak: 0, moving: false, armed: true, hitZ: -Infinity });
        if (!before) continue;
        // A knock is felt when the hand stops (or bounces back) at the door after going at it quickly, so that is when it sounds:
        // not when the hand comes near, nor when it has already gone through. Each hand keeps its own swing.
        const vz = (l[2] - before[2]) / Math.max(dt, 1e-3);
        swing.peak *= Math.exp(-dt / 0.15);
        if (!swing.armed && l[2] < swing.hitZ - 0.04) swing.armed = true;
        if (vz > 0.05) { swing.peak = Math.max(swing.peak, vz); swing.moving = true; }
        const stopped = swing.moving && vz <= 0.05, through = before[2] < DEEP && l[2] >= DEEP;
        if (!stopped && !through) continue;
        swing.moving = false;
        const z = through ? DEEP : l[2];
        if (swing.armed && swing.peak > KNOCK_SPEED && z >= NEAR && z <= DEEP && Math.abs(l[0]) < 0.5 && l[1] > 0.3 && l[1] < 2.1) {
          swing.armed = false; swing.hitZ = z; swing.peak = 0;
          knocked(i, player, hand);
          return;
        }
      }
    } else {
      const l = toLocal(i, view.head.position), f = toLocalDir(i, view.head.forward);
      d.linger[player.id] = Math.abs(l[0]) < 1.2 && l[2] > -3 && l[2] < -1.3 && f[2] > 0.8 ? (d.linger[player.id] || 0) + dt : 0;
      if (d.linger[player.id] > 2.2) {
        d.linger[player.id] = 0;
        knocked(i, player);
        later(0.35, () => knocked(i, player));
        return;
      }
    }
  }
}
function putAway(i) {
  const d = doors[i];
  if (d.giftId && ctx.hierarchy.getSlot(d.giftId) && !d.taker) ctx.world.deleteSlot(d.giftId);
  if (d.entry && d.entry.byId && !d.taker) addItem(i, d.entry);
  d.phase = 'closing'; d.t = 0;
}
async function accept(i, slot, person) {
  const d = doors[i], back = d.phase;
  d.phase = 'accepting'; d.t = 0;
  let item = null;
  try {
    const hash = await ctx.hierarchy.getSlotHash(slot.id);
    for (const kind of KINDS) if (hash && hash === await seedHash(kind)) item = { seed: kind, name: SEEDS[kind].name };
    if (!item) { const tree = pack(slot); if (tree) item = { tree, name: slot.name }; }
  } catch (error) {}
  if (!item || !ctx.hierarchy.getSlot(slot.id) || ctx.grab.isSlotHeld(slot.id)) {
    d.phase = back; d.t = d.expectT; d.shake = 1; d.refused[slot.id] = clock + 4;
    sound(palm(i, 0.1), 170, '#f87171', 6, 0.3);
    return;
  }
  ctx.world.deleteSlot(slot.id);
  item.by = person.name; item.byId = person.id; item.at = Date.now();
  await addItem(i, item);
  chime(palm(i, 0.1), HOUSES[i].color, [523.25, 659.25, 783.99, 1046.5]);
  shared(person, item, i);
}
function step(i, dt) {
  const d = doors[i];
  d.t += dt; d.shake = Math.max(0, d.shake - dt * 3); d.cooldown = Math.max(0, d.cooldown - dt);
  let openT = 0, reachT = 0, curlT = 0.25, droopT = 0, wantT = 0;
  if (d.phase === 'opening') {
    openT = 1;
    if (d.open > 0.95 && !d.loading && d.entry) {
      d.giftId = spawnGift(i, d.entry); d.phase = 'offering'; d.t = 0; d.taker = null;
      chime(toWorld(i, [0.2, 1.3, -1.6]), HOUSES[i].color, [392, 523.25, 659.25]);
    }
  } else if (d.phase === 'offering') {
    openT = 1; reachT = 1; curlT = 0.12;
    const gift = d.giftId && ctx.hierarchy.getSlot(d.giftId);
    const rest = palm(i, 0.09);
    const where = gift && ctx.hierarchy.getWorldPose(d.giftId);
    const held = gift && ctx.grab.isSlotHeld(d.giftId);
    if (!gift || held || (where && dist(where.position, rest) > 0.4)) {
      const at = where ? where.position : rest;
      d.taker = nearestPlayer(at) || d.visitor;
      if (d.taker) state.players[d.taker.id] = d.taker.name;
      d.phase = 'expecting'; d.t = 0; d.expectT = 0; d.scan = 0;
      sound(rest, 330, '#c4b5fd', 8, 0.25);
    } else if (gift) {
      ctx.world.setWorldPose(d.giftId, { position: rest, rotation: [0, 0, 0, 1] }, false);
      dirty = true;
    }
    if (d.phase === 'offering' && d.t > 40) putAway(i);
  } else if (d.phase === 'expecting') {
    openT = 1; reachT = 1; curlT = 0.2; wantT = 1;
    d.expectT = d.t;
    d.scan -= dt;
    if (d.scan <= 0) {
      d.scan = 0.15;
      const here = palm(i, 0.08);
      for (const near of ctx.world.findNear(here, 0.45)) {
        const root = grabbableRoot(near);
        if (!root || root.disabled || root.id.startsWith('hg-keepsake') || root.id.startsWith('hg-seed')) continue;
        if ((d.refused[root.id] || 0) > clock || ctx.grab.isSlotHeld(root.id)) continue;
        const at = ctx.hierarchy.getWorldPose(root.id);
        if (!at || dist(at.position, here) > 0.32) continue;
        // What a door gave, no door takes back: bring something of your own.
        if (root.id.startsWith('hg-g-')) {
          d.refused[root.id] = clock + 4; d.shake = 1;
          sound(palm(i, 0.1), 170, '#f87171', 6, 0.3);
          continue;
        }
        accept(i, root, nearestPlayer(at.position) || d.taker || d.visitor);
        break;
      }
    }
    if (d.t > 75) { d.sad = true; d.phase = 'closing'; d.t = 0; }
  } else if (d.phase === 'accepting') {
    openT = 1; reachT = d.t > 0.6 ? 0 : 1; curlT = 1.35;
    if (d.t > 1.9) { d.phase = 'closing'; d.t = 0; }
  } else if (d.phase === 'closing') {
    reachT = 0; droopT = d.sad ? 0.7 : 0; curlT = d.sad ? 0.9 : 0.6;
    openT = d.reach < 0.2 ? 0 : 1;
    if (d.open < 0.03 && d.reach < 0.04) { d.phase = 'closed'; d.cooldown = 2.5; d.giftId = null; d.taker = null; d.entry = null; d.refused = {}; sound(toWorld(i, [0, 1, -1.3]), 120, HOUSES[i].color, 4, 0.3); }
  }
  d.open = ease(d.open, openT, dt, 3.2);
  d.reach = ease(d.reach, reachT, dt, d.phase === 'accepting' ? 3.5 : 2.4);
  d.curl = ease(d.curl, curlT, dt, 6);
  d.droop = ease(d.droop, droopT, dt, 2);
  d.want = ease(d.want, wantT, dt, 4);
  const on = d.want > 0.05;
  if (on !== d.wantOn) {
    d.wantOn = on;
    enabled(HOUSES[i].id + '-hand-want', on);
    set(HOUSES[i].id + '-glow', 'pointLight', 'color', on ? '#c4b5fd' : '#ffb347');
  }
  animate(i);
}
function animate(i) {
  const d = doors[i], id = HOUSES[i].id, hand = id + '-hand';
  pose(id + '-door', null, q(1, DOOR.swing * d.open + (d.phase === 'closed' ? Math.sin(clock * 70) * 0.05 * d.shake : 0)));
  const z = DOOR.rest - DOOR.reach * d.reach;
  const out = d.reach > 0.5 ? Math.sin(clock * 2) * 0.012 : 0;
  const nod = d.phase === 'accepting' ? Math.sin(d.t * 14) * 0.1 : d.phase === 'expecting' ? Math.sin(clock * 3) * 0.04 : 0;
  pose(hand, [DOOR.handX, DOOR.handY + out, z], mul(q(1, Math.sin(clock * 38) * 0.12 * d.shake), q(0, -d.droop + nod)));
  for (let k = 0; k < 4; k++) pose(hand + '-f' + k, null, q(0, d.curl + d.want * 0.45 * (0.5 + 0.5 * Math.sin(clock * 7 - k * 0.8)) + (k === 0 || k === 3 ? -0.05 : 0)));
  pose(hand + '-thumb', null, mul(q(1, -0.3), q(0, d.curl * 0.5)));
  if (d.want > 0.05) {
    pose(hand + '-want', [0, 0.2 + 0.03 * Math.sin(clock * 3), -0.04], q(1, clock * 1.4), [d.want, d.want, d.want]);
    const pulse = 1 + 0.25 * Math.sin(clock * 4);
    pose(hand + '-want-orb', null, null, [0.34 * pulse, 0.34 * pulse, 0.34 * pulse]);
  }
  set(id + '-glow', 'pointLight', 'intensity', Math.round((d.want > 0.5 ? 1.4 + 0.5 * Math.sin(clock * 4) : 1.6 * d.open) * 100) / 100, false);
}

function init() {
  if (initialized) return;
  state = JSON.parse(JSON.stringify(component(ROOT, 'scriptState')?.data || { phase: 'gathering', shared: 0, players: {} }));
  initialized = true;
  if (!ctx.world.isHost()) return;
  draw();
  if (ctx.storage && ctx.storage.available) {
    ctx.storage.world.get('board', { total: 0, recent: [] }).then((saved) => { if (saved && Array.isArray(saved.recent)) { board = saved; drawBoard(); } }).catch(() => {});
  }
}

return {
  async onPlayerReady(player) {
    init();
    if (!ctx.world.isHost()) return;
    state.players[player.id] = player.name;
    if (state.phase === 'celebration') ensureKeepsake(player);
    publish();
  },
  tick(dt) {
    init();
    if (!ctx.world.isHost()) return;
    dt = Math.min(Math.max(dt, 0), 0.25);
    clock += dt; flushIn -= dt;
    for (let k = timers.length - 1; k >= 0; k--) if (timers[k].at <= clock) { const fn = timers[k].fn; timers.splice(k, 1); fn(); }
    const views = [];
    for (const player of ctx.world.getPlayers()) { const view = ctx.world.getPlayerPose(player.id); if (view) views.push([player, view]); }
    for (let i = 0; i < HOUSES.length; i++) { listen(i, views, dt); step(i, dt); }
    if (state.phase === 'celebration') {
      for (let i = 0; i < 3; i++) {
        const angle = clock * 0.22 + i * Math.PI * 2 / 3;
        ctx.world.setWorldPose('hg-ghost-' + i, { position: [CENTER[0] + Math.sin(angle) * 3.2, 2.25 + Math.sin(clock * 1.4 + i) * 0.22, CENTER[2] + Math.cos(angle) * 3.2] }, false);
      }
      dirty = true;
    }
    if (dirty && flushIn <= 0) { flushIn = 0.1; dirty = false; ctx.world.flush(); }
  }
};
`;
