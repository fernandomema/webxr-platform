import type { Component, Quat, Slot, SlotTree } from '@kithin/engine/ecs/types';

/**
 * A jukebox that plays records: six slots that take any record (`recordDisc` with its song), played one after the other in the order of the slots
 * and round again, the same one at the same time for everybody (the host says what plays and since when, in the panel's `scriptState`; every
 * device plays it from where it is by then, positioned at the jukebox). The record that plays turns, so that it can be told from the others. With no
 * records it plays a quiet tune of its own (a synthesised one, no file), which the panel switches off. Skip moves on.
 *
 * Its origin is on the floor in the middle of its base, and its front (the slots and the panel) is towards -Z, like a sign: turn the slot that loads
 * it to face the room. 1.1 m wide, 0.7 m deep, 1.8 m tall. Everything is shapes and one script, so any world can load it (`loader`, adapter
 * `builtin`, id `jukebox`) at no cost to its own size. The script finds its parts from its own panel's id, so it works however the id is prefixed.
 */
export const JUKEBOX_ID = 'jukebox';
export const JUKEBOX_SLOTS = 6;
const PANEL = `${JUKEBOX_ID}-panel`;
export const jukeboxSlotId = (i: number) => `${JUKEBOX_ID}-slot-${i}`;

const PITCH_90: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const ROLL_90: Quat = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
const FRONT = -0.35;

/** Where record slot `i` is, in the jukebox's own frame: two rows of three on the front, the first row on top, left to right as seen from the front. */
export function jukeboxSlotAt(i: number): [number, number, number] {
	return [((i % 3) - 1) * 0.32, Math.floor(i / 3) === 0 ? 1.13 : 0.79, FRONT - 0.035];
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
	const button = (id: string, text: string, background: string): Slot => ui(id, row, 'button', { width: 210, height: 64, text, fontSize: 22, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, background });
	return [
		{ id: JUKEBOX_ID, parentId: null, name: 'Jukebox', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components: [{ type: 'container' }] },
		shape('body', 'Jukebox Body', 'box', '#3a1230', [0, 0.8, 0], [1.1, 1.6, 0.7], { solid: true }),
		shape('arch', 'Jukebox Arch', 'cylinder', '#3a1230', [0, 1.62, 0], [0.7, 1.1, 0.7], { rotation: ROLL_90, solid: true }),
		// The lit window the records stand against, and a trim over it.
		shape('glow', 'Jukebox Glow', 'box', '#ff7a3d', [0, 1.0, FRONT - 0.01], [0.85, 0.9, 0.02], { unlit: true }),
		shape('trim', 'Jukebox Trim', 'box', '#25e6ff', [0, 1.62, FRONT - 0.01], [0.85, 0.22, 0.02], { unlit: true }),
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
					components: [{ type: 'socket', accepts: ['disc'], radius: 0.2, snap: { position: [0, 0, 0], rotation: [90, -180, 0] }, playMedia: false }]
				},
				shape(`ring-${i}`, 'Record Slot Ring', 'cylinder', '#1a0a12', [at[0], at[1], at[2] + 0.004], [0.33, 0.006, 0.33], { rotation: PITCH_90 })
			];
		}).flat(),
		{
			id: panel,
			parentId: JUKEBOX_ID,
			name: 'Jukebox Panel',
			position: [0, 0.3, FRONT - 0.035],
			rotation: [0, 0, 0, 1],
			scale: [1, 1, 1],
			// The script keeps what is playing (and since when) in `scriptState`, which every player reads to play the same record.
			components: [{ type: 'uiPanel', width: 480, height: 300, worldWidth: 0.7, background: '#150a1f' }, { type: 'scriptState', data: {} }, { type: 'codeBlock', code: JUKEBOX_SCRIPT }]
		},
		ui('title', panel, 'text', { text: 'JUKEBOX', width: 420, height: 40, fontSize: 30, fontWeight: 'bold', textAlign: 'center', color: '#ff9f5a' }),
		ui('now', panel, 'text', { text: 'Put a record in a slot', width: 440, height: 110, fontSize: 22, textAlign: 'center', color: '#ffe2c4' }),
		ui('row', panel, 'container', { width: 430, height: 70, flexDirection: 'row', gap: 10, margin: 4 }),
		button('toggle', 'Ambient: ON', '#16a34a'),
		button('next', 'Next tune', '#1e293b')
	];
}

const SCRIPT_DATA = { panel: PANEL, sockets: Array.from({ length: JUKEBOX_SLOTS }, (_, i) => jukeboxSlotId(i)) };

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

const set = (id, field, value) => ctx.world.setComponentField(id, 'uiElement', field, value, true);
const host = () => ctx.world.isHost();

// ---------------------------------------------------------------- the records

const stateOf = () => { const c = ctx.self.getComponent('scriptState'); return (c && c.data) || {}; };

function occupantOf(i) {
  const slot = ctx.hierarchy.getSlot(at(DATA.sockets[i]));
  const socket = slot && slot.components.find((c) => c.type === 'socket');
  return (socket && socket.occupantId) || '';
}

/** What is known of a record: its song and its title and author. Null for something that is not a record with a song. */
function recordOf(id) {
  const slot = id ? ctx.hierarchy.getSlot(id) : null;
  const audio = slot && slot.components.find((c) => c.type === 'audioPlayer');
  if (!slot || !audio || !audio.source) return null;
  const info = slot.components.find((c) => c.type === 'recordDisc');
  return { id: id, source: audio.source, title: (info && info.title) || String(slot.name).replace(/^Disc: /, ''), author: (info && info.author) || '' };
}

/** The records in the slots, in order, with the number of the slot. */
function playlist() {
  const list = [];
  for (let i = 0; i < DATA.sockets.length; i++) { const record = recordOf(occupantOf(i)); if (record && !failed.has(record.id)) { record.index = i; list.push(record); } }
  return list;
}

const nextAfter = (list, index) => list.find((record) => record.index > index) || list[0] || null;
const label = (record) => record.title + (record.author ? ' - ' + record.author : '');

function write(record) {
  const data = record
    ? { cur: record.index, discId: record.id, startedAt: Date.now(), key: String(++counter) + ':' + record.id, title: record.title, author: record.author }
    : { cur: -1, discId: '', startedAt: 0, key: 'idle:' + (++counter), title: '', author: '' };
  ctx.world.setComponentField(ctx.self.id, 'scriptState', 'data', data);
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
  paintNow(list, playing);
}

/** Every player: if the record that is playing is not the one heard here, stop this one and start that, from where it is by now. */
function playHere() {
  const state = stateOf();
  const key = state.key || '';
  if (key === local.key) return;
  if (local.handle) { try { local.handle.stop(); } catch (error) { /* already over */ } }
  local.handle = null;
  local.key = key;
  const token = ++local.token;
  if (!(state.cur >= 0) || !state.discId) return;
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
  const id = state.cur >= 0 && occupantOf(state.cur) === state.discId ? state.discId : '';
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
  // A turn about the record's own axis (its local up, the way a cylinder is made) after the way it is seated.
  ctx.world.setWorldPose(id, { rotation: ctx.math.quatMultiply(spin.base, ctx.math.quatFromAxisAngle([0, 1, 0], spin.angle)) }, false);
  spin.flush += dt;
  if (spin.flush >= 0.05) { spin.flush = 0; ctx.world.flush(); }
}

/** Where the sound comes from: the middle of the jukebox, a little above its panel. */
function speakers() { const p = ctx.self.getWorldPosition(); return [p[0], p[1] + 0.7, p[2]]; }

function paintNow(list, playing) {
  const next = playing ? nextAfter(list, playing.index) : null;
  const text = playing
    ? 'Now playing\n' + label(playing) + (list.length > 1 && next ? '\nNext: ' + label(next) : '')
    : list.length ? 'Starting...' : 'Put a record in a slot.\n' + (on ? 'Ambient music is on.' : 'It is quiet.');
  const nextLabel = playing ? 'Skip' : TUNES[tune].name;
  const signature = text + '|' + nextLabel;
  if (signature === shown) return;
  shown = signature;
  set(at('jukebox-now'), 'text', text);
  set(at('jukebox-next'), 'text', nextLabel);
}

// ---------------------------------------------------------------- the ambient tune

function paintButtons() {
  set(at('jukebox-toggle'), 'text', 'Ambient: ' + (on ? 'ON' : 'OFF'));
  set(at('jukebox-toggle'), 'background', on ? '#16a34a' : '#7f1d1d');
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
    else if (event.slotId === at('jukebox-next')) {
      if (stateOf().cur >= 0) skip = true;
      else { tune = (tune + 1) % TUNES.length; step = 0; random = mulberry(7 + tune); shown = ''; }
    }
  },
  tick(dt) {
    playHere();
    if (!host()) return;
    hostPlaylist();
    spinTick(dt);
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
