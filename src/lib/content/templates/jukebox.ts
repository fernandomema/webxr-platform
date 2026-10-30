import type { AssetId } from '@kithin/engine/assets/ref';
import type { Component, Quat, Slot, SlotTree } from '@kithin/engine/ecs/types';
import { eulerToQuat } from '@kithin/engine/math/euler';

/**
 * A jukebox that plays records: it keeps up to five behind its glass (`recordDisc` with its song), played one after the other in the order of their places
 * and round again, the same one at the same time for everybody (the host says what plays and since when, in the panel's `scriptState`; every
 * device plays it from where it is by then, positioned at the jukebox). The record that plays is moved to the turntable (the sixth place, flat) and turns there,
 * and goes back to its place when the next one starts. Records are put in through the tray: the panel's "Add record" slides it out, and once a record is let go on it
 * the tray closes and the script seats the record in a free place. With no records it plays a quiet tune of its own (a synthesised one, no file), which the
 * panel switches off. Skip moves on.
 *
 * Its origin is on the floor in the middle of its base, and its front (the slots and the panel) is towards -Z, like a sign: turn the slot that loads
 * it to face the room. About 1.05 m wide, 0.84 m deep, 1.8 m tall. The cabinet is the CC0 "Jukebox" model of Grab3D (light variant, 10.7k triangles,
 * bundled with the app: see `static/assets/models/LICENSES.md`); the slots, the panel and the script are ours, so any world can load it (`loader`, adapter
 * `builtin`, id `jukebox`). The script finds its parts from its own panel's id, so it works however the id is prefixed.
 */
export const JUKEBOX_ID = 'jukebox';
export const JUKEBOX_SLOTS = 6;
const PANEL = `${JUKEBOX_ID}-panel`;
export const jukeboxSlotId = (i: number) => `${JUKEBOX_ID}-slot-${i}`;

const PITCH_90: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const ROLL_180: Quat = [1, 0, 0, 0];
/** The cabinet model (`static/assets/models/jukebox.glb`, registered in `bundledAssets.ts`). */
export const JUKEBOX_MODEL: AssetId = 'sha256:d233a9da0efed659ffa52e2fce722f6239dbd5893d43d30c41051d441360f455';
/** The file is 0.877 x 1.509 x 0.70 m with its front towards +Z and its origin on the floor in the middle; scaled up to the size above and turned to face -Z. */
const MODEL_SCALE = 1.2;
const YAW_180: Quat = [0, 1, 0, 0];

/**
 * Where record slot `i` is, in the jukebox's own frame: behind the glass, five records standing label to the front on an arc over the turntable (slots 0, 1, 2,
 * 5 and 4, left to right as seen from the front) and slot 3 lying flat on the turntable itself.
 */
const SLOT_AT: [number, number, number][] = [
	[-0.252, 1.207, 0.034], [-0.154, 1.33, 0.043], [0, 1.381, 0.052], [0.003, 1.002, -0.077], [0.249, 1.204, 0.034], [0.149, 1.336, 0.037]
];
/** The turntable: the place the record that plays is moved to. The others (`STORAGE_SLOTS`) are where records wait. */
const FLAT_SLOT = 3;
const STORAGE_SLOTS = [0, 1, 2, 4, 5];
const slotSnap = (i: number) => ({ position: [0, 0, 0] as [number, number, number], rotation: i === FLAT_SLOT ? [0, 0, 0] as [number, number, number] : [90, -180, 0] as [number, number, number] });

/** The tray under the panel: it slides out of the cabinet's front (towards -Z) when asked and takes a record laid on it. */
const TRAY = `${JUKEBOX_ID}-tray`;
const TRAY_SOCKET = `${JUKEBOX_ID}-tray-socket`;
const TRAY_CLOSED: [number, number, number] = [0, 0.5659, -0.1227];
const TRAY_OPEN: [number, number, number] = [0, 0.5659, -0.4427];
const TRAY_RADIUS = 0.18;
export function jukeboxSlotAt(i: number): [number, number, number] {
	return SLOT_AT[i];
}

const shape = (id: string, name: string, kind: 'box' | 'cylinder', color: string, position: Slot['position'], scale: Slot['scale'], extra: Partial<Slot> & { unlit?: boolean; solid?: boolean } = {}): Slot => {
	const { unlit, solid, ...rest } = extra;
	return {
		id: `${JUKEBOX_ID}-${id}`,
		parentId: JUKEBOX_ID,
		name,
		position,
		rotation: [0, 0, 0, 1],
		scale,
		...rest,
		components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: kind }, color, ...(unlit ? { unlit: true } : {}) }, ...(solid ? [{ type: 'collider', shape: 'box' } as Component] : [])]
	};
};

const ui = (id: string, parentId: string, kind: 'container' | 'text' | 'button', element: Record<string, unknown>): Slot => ({
	id: `${JUKEBOX_ID}-${id}`,
	parentId,
	name: id,
	position: [0, 0, 0],
	rotation: [0, 0, 0, 1],
	scale: [1, 1, 1],
	components: [{ type: 'uiElement', kind, ...element } as Component]
});

export function buildJukebox(): SlotTree {
	const panel = `${JUKEBOX_ID}-panel`;
	const row = `${JUKEBOX_ID}-row`;
	const button = (id: string, text: string, background: string): Slot => ui(id, row, 'button', { width: 138, height: 54, text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background });
	return [
		{ id: JUKEBOX_ID, parentId: null, name: 'Jukebox', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'container' }] },
		{
			id: `${JUKEBOX_ID}-model`,
			parentId: JUKEBOX_ID,
			name: 'Jukebox Cabinet',
			position: [0, 0, 0],
			rotation: YAW_180,
			scale: [MODEL_SCALE, MODEL_SCALE, MODEL_SCALE],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: JUKEBOX_MODEL }, modelScale: 'native' },
				// A mesh collider: a box would not do, as a model always has an invisible box of its whole size that rays hit before the panel set into its front.
				{ type: 'collider', shape: 'mesh' }
			]
		},
		// The six places: a socket that takes a record standing on its edge, label to the front, and a dark ring round it.
		...Array.from({ length: JUKEBOX_SLOTS }, (_, i): Slot[] => {
			const at = jukeboxSlotAt(i);
			return [
				{
					id: jukeboxSlotId(i),
					parentId: JUKEBOX_ID,
					name: `Record Slot ${i + 1}`,
					position: at,
					rotation: [0, 0, 0, 1],
					scale: [1, 1, 1],
					// Close to its neighbours, so the reach is small.
					components: [{ type: 'socket', accepts: ['disc'], radius: 0.075, snap: slotSnap(i), playMedia: false }]
				},
				shape(`ring-${i}`, 'Record Slot Ring', 'cylinder', '#1a0a12', at, [0.18, 0.006, 0.18], { rotation: i === FLAT_SLOT ? ROLL_180 : PITCH_90 })
			];
		}).flat(),
		// The tray: a plate with a lip, and the socket a record is let go on. Closed, it is inside the cabinet and its socket reaches nothing.
		{ id: TRAY, parentId: JUKEBOX_ID, name: 'Record Tray', position: TRAY_CLOSED, rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'container' }] },
		shape('tray-plate', 'Record Tray Plate', 'box', '#2b2b33', [0, 0, 0], [0.36, 0.025, 0.36], { parentId: TRAY }),
		shape('tray-lip', 'Record Tray Lip', 'box', '#9aa0a8', [0, 0.02, -0.18], [0.36, 0.06, 0.02], { parentId: TRAY }),
		{
			id: TRAY_SOCKET,
			parentId: TRAY,
			name: 'Record Tray Socket',
			position: [0, 0, 0],
			rotation: [0, 0, 0, 1],
			scale: [1, 1, 1],
			components: [{ type: 'socket', accepts: ['disc'], radius: 0.0001, snap: { position: [0, 0.02, 0], rotation: [0, 0, 0] }, playMedia: false }]
		},
		{
			id: panel,
			parentId: JUKEBOX_ID,
			name: 'Jukebox Panel',
			// On the sloped lower front of the cabinet: tilted back about 35 degrees, a little wider than tall.
			position: [0, 0.761, -0.379],
			rotation: [0.3049, 0, 0, 0.9524],
			scale: [1.11, 1, 1],
			// The script keeps what is playing (and since when) in `scriptState`, which every player reads to play the same record.
			components: [{ type: 'uiPanel', width: 480, height: 135, worldWidth: 0.7, background: '#a39c92', lit: true }, { type: 'scriptState', data: {} }, { type: 'codeBlock', code: JUKEBOX_SCRIPT }]
		},
		ui('now', panel, 'text', { text: 'Add a record with the tray', width: 440, height: 54, fontSize: 21, textAlign: 'center', color: '#ffe2c4' }),
		ui('row', panel, 'container', { width: 440, height: 58, flexDirection: 'row', gap: 10, margin: 2 }),
		button('toggle', 'Ambient: ON', '#52746d'),
		button('next', 'Next tune', '#63646b'),
		button('add', 'Add record', '#6b5b73')
	];
}

const SCRIPT_DATA = {
	panel: PANEL,
	sockets: Array.from({ length: JUKEBOX_SLOTS }, (_, i) => jukeboxSlotId(i)),
	snaps: Array.from({ length: JUKEBOX_SLOTS }, (_, i) => ({ position: slotSnap(i).position, rotation: eulerToQuat(slotSnap(i).rotation) })),
	turntable: FLAT_SLOT,
	storage: STORAGE_SLOTS,
	tray: TRAY,
	traySocket: TRAY_SOCKET,
	traySnap: { position: [0, 0.02, 0], rotation: [0, 0, 0, 1] },
	trayClosed: TRAY_CLOSED,
	trayOpen: TRAY_OPEN,
	trayRadius: TRAY_RADIUS
};

/** The jukebox's script (see above). */
const JUKEBOX_SCRIPT = String.raw`
const DATA = ${JSON.stringify(SCRIPT_DATA)};
// Built by a loader, every id of the object has the loader's id in front of it: the ones used here are found from this panel's own.
const PREFIX = ctx.self.id.endsWith(DATA.panel) ? ctx.self.id.slice(0, ctx.self.id.length - DATA.panel.length) : '';
const at = (id) => PREFIX + id;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const TUNES = [
  { name: 'Lounge', bpm: 84, bars: [[48, [60, 64, 67, 71]], [45, [57, 60, 64, 67]], [50, [62, 65, 69, 72]], [43, [59, 62, 65, 67]]], bass: 0.14, voice: 0.09 },
  { name: 'Neon', bpm: 112, bars: [[45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [48, [60, 64, 67, 72]], [43, [59, 62, 67, 71]]], bass: 0.16, voice: 0.08 }
];
const mulberry = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let on = true;
let tune = 0;
let step = 0;
let wait = 0;
let random = mulberry(7);
let counter = 0;
let skip = false;
let shown = '';
const failed = new Set();
const local = { key: '', token: 0, handle: null };
const SPIN_SPEED = 2.2;
const homes = {};
const tray = { open: false, t: 0, settle: 0, idle: 0, flush: 0, carry: '', reach: false, notice: '', noticeLeft: 0 };
const TRAY_SPEED = 2.5;

const set = (id, field, value) => ctx.world.setComponentField(id, 'uiElement', field, value, true);
const host = () => ctx.world.isHost();

// ---------------------------------------------------------------- the records

// Every read of the world from here is a trip out of the script, so the tick keeps what it read: the shared state once per frame, and which record
// is in each place once per pass of the playlist (a few times a second, see PASS_SECONDS), corrected at once by the moves made here.
let frameState = null;
const stateOf = () => frameState || (frameState = ctx.self.getField('scriptState', 'data') || {});

const socketId = (i) => at(DATA.sockets[i]);
const SOCKET_IDS = DATA.sockets.map((_, i) => socketId(i));
let occupants = SOCKET_IDS.map(() => '');
function readOccupants() { occupants = SOCKET_IDS.map((id) => ctx.hierarchy.getField(id, 'socket', 'occupantId') || ''); }
const occupantOf = (i) => occupants[i];
const PASS_SECONDS = 0.1;
let pass = 0;

/** What is known of a record: its song and its title and author. Null for something that is not a record with a song. */
function recordOf(id) {
  const source = id ? ctx.hierarchy.getField(id, 'audioPlayer', 'source') : null;
  if (!source) return null;
  let title = ctx.hierarchy.getField(id, 'recordDisc', 'title');
  if (!title) { const slot = ctx.hierarchy.getSlot(id); title = slot ? String(slot.name).replace(/^Disc: /, '') : id; }
  return { id: id, source: source, title: title, author: ctx.hierarchy.getField(id, 'recordDisc', 'author') || '' };
}

/** The records, in the order of the places they wait in (the one on the turntable counts where it came from), with the number of that place. */
function playlist() {
  const list = [];
  for (let i = 0; i < DATA.sockets.length; i++) {
    const id = occupantOf(i);
    const record = recordOf(id);
    if (!record || failed.has(record.id)) continue;
    record.index = i === DATA.turntable && homes[id] !== undefined ? homes[id] : i;
    list.push(record);
  }
  return list.sort((a, b) => a.index - b.index);
}

/** Moves a record from the socket it is in to another one and seats it there. False when it could not be moved (a hand holds it). */
function moveDisc(discId, fromSocket, toSocket, snap) {
  if (ctx.grab.isSlotHeld(discId) || !ctx.world.setParent(discId, toSocket)) return false;
  ctx.world.setComponentField(fromSocket, 'socket', 'occupantId', '');
  ctx.world.setLocalPose(discId, { position: snap.position, rotation: snap.rotation });
  ctx.world.setComponentField(toSocket, 'socket', 'occupantId', discId);
  const from = SOCKET_IDS.indexOf(fromSocket);
  const to = SOCKET_IDS.indexOf(toSocket);
  if (from >= 0) occupants[from] = '';
  if (to >= 0) occupants[to] = discId;
  return true;
}

/** The place a new record can be seated in: empty, and not the one the record on the turntable will go back to. */
function freePlace() {
  const reserved = homes[occupantOf(DATA.turntable)];
  return DATA.storage.find((i) => i !== reserved && !occupantOf(i));
}

/** Keeps the record that plays on the turntable and every other one in its place. */
function seatTurntable(wantedId) {
  const turntable = DATA.turntable;
  const there = occupantOf(turntable);
  if (there && there !== wantedId) {
    let home = homes[there];
    if (home === undefined || occupantOf(home)) home = DATA.storage.find((i) => !occupantOf(i));
    if (home !== undefined) {
      if (spin.id === there) { spin.id = ''; spin.base = null; }
      if (moveDisc(there, socketId(turntable), socketId(home), DATA.snaps[home])) delete homes[there];
    }
  }
  if (!wantedId || occupantOf(turntable)) return;
  for (const i of DATA.storage) {
    if (occupantOf(i) === wantedId && moveDisc(wantedId, socketId(i), socketId(turntable), DATA.snaps[turntable])) { homes[wantedId] = i; return; }
  }
}

const nextAfter = (list, index) => list.find((record) => record.index > index) || list[0] || null;
const label = (record) => record.title + (record.author ? ' - ' + record.author : '');

function write(record) {
  const data = record
    ? { cur: record.index, discId: record.id, startedAt: Date.now(), key: String(++counter) + ':' + record.id, title: record.title, author: record.author }
    : { cur: -1, discId: '', startedAt: 0, key: 'idle:' + (++counter), title: '', author: '' };
  ctx.world.setComponentField(ctx.self.id, 'scriptState', 'data', data);
  frameState = data;
}

/** What the host does every frame about the playlist: start a record, move on when it ends, is taken out or is skipped. */
function hostPlaylist() {
  const list = playlist();
  const state = stateOf();
  const playing = state.cur >= 0 ? list.find((record) => record.index === state.cur && record.id === state.discId) : null;
  const over = local.key === state.key && local.handle && local.handle.ended;
  if (!playing) {
    if (list.length === 0) { if (state.cur >= 0) write(null); }
    else write(nextAfter(list, state.cur >= 0 ? state.cur : -1));
  } else if (over || skip) {
    write(nextAfter(list, state.cur));
  }
  skip = false;
  seatTurntable(playing ? playing.id : '');
  paintNow(list, playing);
}

/**
 * Every player: if the record that is playing is not the one heard here, stop this one and start that, from where it is by now. A record
 * in a hand or out of the jukebox is silent on every device straight away, without waiting for the host to move on: a guest who pulls it
 * out hears it stop as it comes out.
 */
function playHere() {
  const state = stateOf();
  const discId = state.cur >= 0 ? state.discId : '';
  const away = !!discId && (ctx.grab.isSlotHeld(discId) || !DATA.sockets.some((_, i) => occupantOf(i) === discId));
  const key = (away ? 'away:' : '') + (state.key || '');
  if (key === local.key) return;
  if (local.handle) { try { local.handle.stop(); } catch (error) { /* already over */ } }
  local.handle = null;
  local.key = key;
  const token = ++local.token;
  if (away || !(state.cur >= 0) || !state.discId) return;
  const record = recordOf(state.discId);
  if (!record) return;
  const offset = Math.max(0, (Date.now() - state.startedAt) / 1000);
  Promise.resolve(ctx.audio.playAt(record.source, speakers(), { volume: 0.75, offset: offset, refDistance: 4, maxDistance: 45 }))
    .then((handle) => { if (token !== local.token) handle.stop(); else local.handle = handle; })
    .catch((error) => { ctx.log('jukebox: ' + (error && error.message ? error.message : error)); if (host()) failed.add(state.discId); });
}

/**
 * The record that is playing turns on its own axis, to tell it from the others: it keeps the way it was seated (the base) and adds a turn about its
 * own centre. Only the host moves it (the guests get the pose); the one that stops goes back to how it was seated.
 */
const spin = { id: '', base: null, angle: 0, flush: 0 };
function spinTick(dt) {
  const state = stateOf();
  const id = state.cur >= 0 && occupantOf(DATA.turntable) === state.discId ? state.discId : '';
  if (spin.id && spin.id !== id) {
    if (spin.base && ctx.hierarchy.getSlot(spin.id) && !ctx.grab.isSlotHeld(spin.id)) { ctx.world.setWorldPose(spin.id, { rotation: spin.base }, false); ctx.world.flush(); }
    spin.id = '';
    spin.base = null;
  }
  if (!id || ctx.grab.isSlotHeld(id)) return;
  if (spin.id !== id) {
    const pose = ctx.hierarchy.getWorldPose(id);
    if (!pose) return;
    spin.id = id;
    spin.base = pose.rotation.slice();
    spin.angle = 0;
  }
  spin.angle = (spin.angle + dt * SPIN_SPEED) % (Math.PI * 2);
  // A turn about the record's own axis (its local up, the way a cylinder is made) after the way it is seated: base * (turn about Y), worked out here.
  const b = spin.base;
  const s = Math.sin(spin.angle / 2);
  const c = Math.cos(spin.angle / 2);
  ctx.world.setWorldPose(id, { rotation: [b[0] * c - b[2] * s, b[1] * c + b[3] * s, b[0] * s + b[2] * c, b[3] * c - b[1] * s] }, false);
  spin.flush += dt;
  if (spin.flush >= 0.05) { spin.flush = 0; ctx.world.flush(); }
}

/** Where the sound comes from: the middle of the jukebox, a little above its panel. */
function speakers() { const p = ctx.self.getWorldPosition(); return [p[0], p[1] + 0.7, p[2]]; }

const clip = (text) => text.length > 38 ? text.slice(0, 37) + '...' : text;

function paintNow(list, playing) {
  const next = playing ? nextAfter(list, playing.index) : null;
  let text = playing
    ? clip(label(playing)) + (list.length > 1 && next ? '\nNext: ' + clip(label(next)) : '')
    : list.length ? 'Starting...' : 'Add a record with the tray.\n' + (on ? 'Ambient music is on.' : 'It is quiet.');
  if (tray.noticeLeft > 0) text = tray.notice;
  else if (tray.open) text = 'Lay a record on the tray.';
  const nextLabel = playing ? 'Skip' : TUNES[tune].name;
  const addLabel = tray.open ? 'Close tray' : 'Add record';
  const signature = text + '|' + nextLabel + '|' + addLabel;
  if (signature === shown) return;
  shown = signature;
  set(at('jukebox-now'), 'text', text);
  set(at('jukebox-next'), 'text', nextLabel);
  set(at('jukebox-add'), 'text', addLabel);
}

// ---------------------------------------------------------------- the tray

const trayOccupant = () => {
  const slot = ctx.hierarchy.getSlot(at(DATA.traySocket));
  const socket = slot && slot.components.find((c) => c.type === 'socket');
  return (socket && socket.occupantId) || '';
};

function say(text) { tray.notice = text; tray.noticeLeft = 3; shown = ''; }

/** The "Add record" button: slides the tray out, or back in (taking in the record on it, if any). */
function toggleTray() {
  if (tray.open) { tray.open = false; tray.carry = trayOccupant(); return; }
  if (freePlace() === undefined) { say('The jukebox is full.'); return; }
  tray.open = true;
  tray.idle = 0;
  shown = '';
}

/**
 * The tray at work: it slides out and in, closes by itself once a record is let go on it (or nobody uses it), and when it is shut again the record is seated
 * in a free place. Its socket only reaches while it is fully out.
 */
function trayTick(dt) {
  if (tray.noticeLeft > 0) { tray.noticeLeft -= dt; if (tray.noticeLeft <= 0) shown = ''; }
  // Shut and carrying nothing, nobody can lay a record on it: there is nothing to look at.
  const occupant = tray.open || tray.carry ? trayOccupant() : '';
  if (tray.open) {
    if (occupant && !ctx.grab.isSlotHeld(occupant)) { tray.settle += dt; if (tray.settle > 0.6) { tray.open = false; tray.carry = occupant; tray.settle = 0; shown = ''; } }
    else tray.settle = 0;
    tray.idle = occupant ? 0 : tray.idle + dt;
    if (tray.idle > 30) { tray.open = false; shown = ''; }
  }
  const goal = tray.open ? 1 : 0;
  if (tray.t !== goal) {
    tray.t = goal > tray.t ? Math.min(goal, tray.t + dt * TRAY_SPEED) : Math.max(goal, tray.t - dt * TRAY_SPEED);
    const position = DATA.trayClosed.map((v, k) => v + (DATA.trayOpen[k] - v) * tray.t);
    tray.flush += dt;
    const done = tray.t === goal;
    ctx.world.setLocalPose(at(DATA.tray), { position: position }, done);
    if (done || tray.flush >= 0.05) { tray.flush = 0; ctx.world.flush(); }
  }
  const reach = tray.t >= 1;
  if (reach !== tray.reach) { tray.reach = reach; ctx.world.setComponentField(at(DATA.traySocket), 'socket', 'radius', reach ? DATA.trayRadius : 0.0001); }
  if (!tray.open && tray.t === 0 && tray.carry) {
    const id = tray.carry;
    if (trayOccupant() !== id) tray.carry = '';
    else {
      const place = freePlace();
      if (place === undefined) { tray.open = true; tray.idle = 0; tray.carry = ''; say('The jukebox is full.'); }
      else if (moveDisc(id, at(DATA.traySocket), socketId(place), DATA.snaps[place])) tray.carry = '';
    }
  }
}

// ---------------------------------------------------------------- the ambient tune

function paintButtons() {
  set(at('jukebox-toggle'), 'text', 'Ambient: ' + (on ? 'ON' : 'OFF'));
  set(at('jukebox-toggle'), 'background', on ? '#52746d' : '#7f1d1d');
  shown = '';
}

function note(frequency, ms, volume) { ctx.audio.play({ frequency: frequency, pitchDrop: 0, noiseMix: 0.03, durationMs: ms, volume: volume }); }

function playStep() {
  const t = TUNES[tune];
  const bar = t.bars[Math.floor(step / 8) % t.bars.length];
  const i = step % 8;
  if (i === 0 || i === 4) note(midi(bar[0]), 520, t.bass);
  if (i === 2 || i === 6) { note(midi(bar[1][1]), 700, t.voice); note(midi(bar[1][2]), 700, t.voice * 0.8); }
  if (random() < 0.42) note(midi(bar[1][Math.floor(random() * bar[1].length)] + (random() < 0.3 ? 12 : 0)), 850, t.voice * 0.9);
  step += 1;
}

return {
  onUIEvent(event) {
    if (event.type !== 'press' || !host()) return;
    if (event.slotId === at('jukebox-toggle')) { on = !on; paintButtons(); }
    else if (event.slotId === at('jukebox-add')) toggleTray();
    else if (event.slotId === at('jukebox-next')) {
      if (stateOf().cur >= 0) skip = true;
      else { tune = (tune + 1) % TUNES.length; step = 0; random = mulberry(7 + tune); shown = ''; }
    }
  },
  tick(dt) {
    frameState = null;
    pass -= dt;
    const passing = pass <= 0;
    if (passing) { pass = PASS_SECONDS; readOccupants(); }
    playHere();
    if (!host()) return;
    if (passing) hostPlaylist();
    spinTick(dt);
    trayTick(dt);
    // The tune only plays while there is no record.
    if (!on || stateOf().cur >= 0) return;
    wait -= dt;
    if (wait > 0) return;
    wait += 60 / TUNES[tune].bpm / 2;
    if (wait < 0) wait = 0;
    playStep();
  }
};
`;
